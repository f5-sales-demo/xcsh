import type { IntegrationHandle } from "../../integrations/types";
import type { InteractiveModeContext } from "../types";
import { HookInputComponent } from "./hook-input";
import { runReviewedAction } from "./reviewed-action-dialog";

export async function reviewIntegrationConfiguration(
	ctx: InteractiveModeContext,
	handle: IntegrationHandle<unknown>,
	runReview: typeof runReviewedAction = runReviewedAction,
): Promise<void> {
	if (!handle.prepareConfiguration) return;
	if ((await handle.get()).state !== "ready")
		throw new Error("Configuration setup requires a ready authenticated integration");
	const plan = await handle.prepareConfiguration();
	{
		const answers: Record<string, string> = {};
		for (const question of plan.questions) {
			const value = await ctx.showHookCustom<string | undefined>(
				(ui, _theme, _keys, done) =>
					new HookInputComponent(
						`${plan.title}: ${question.prompt}`,
						`${question.options?.join(", ") ?? ""} Default: ${question.defaultValue ?? "none"}`,
						done,
						() => done(undefined),
						{ tui: ui },
					),
			);
			if (value === undefined) throw new Error("Integration configuration setup cancelled");
			answers[question.id] = value || question.defaultValue || "";
		}
		await plan.validate(answers);
		const review = {
			identity: `configuration:${handle.id}`,
			scope: handle.plugin ?? handle.id,
			revision: JSON.stringify(answers),
			changes: plan.questions.map(q => ({ field: q.prompt, before: "current configuration", after: answers[q.id] })),
			consequence: plan.summary.join("\n"),
		};
		const outcome = await runReview(ctx, plan.title, {
			review,
			resolve: async () => ({ review, target: answers }),
			execute: async (target, signal) => {
				await plan.validate(target, signal);
				await plan.apply(Object.freeze({ ...target }), signal);
				handle.invalidate();
			},
		});
		if (outcome !== "succeeded") throw new Error("Integration configuration setup cancelled or unresolved");
	}
}
