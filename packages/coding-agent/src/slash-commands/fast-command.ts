import type { ActionReview } from "../modes/components/reviewed-action";
import { runReviewedAction } from "../modes/components/reviewed-action-dialog";
import { ConnectionChoiceComponent } from "../modes/components/selector-frame";
import type { InteractiveModeContext } from "../modes/types";

const active = new WeakSet<InteractiveModeContext>();
const unresolved = new WeakMap<InteractiveModeContext["sessionManager"], { sessionId: string; proposed: boolean }>();
export async function handleFastCommand(ctx: InteractiveModeContext, argument: string): Promise<void> {
	const arg = argument.trim().toLowerCase();
	if (arg === "status") {
		const pending = unresolved.get(ctx.sessionManager);
		ctx.showStatus(
			`Fast mode: ${ctx.session.isFastModeEnabled() ? "on" : "off"} (current session).${pending?.sessionId === ctx.sessionManager.getSessionId() ? " Saving is unresolved; review the same mode to retry." : ""}`,
		);
		return;
	}
	if (!["", "on", "off", "toggle"].includes(arg)) {
		ctx.showError("Usage: /fast [on|off|status|toggle]");
		return;
	}
	if (active.has(ctx)) {
		ctx.showStatus("A fast-mode review is already open.");
		return;
	}
	active.add(ctx);
	try {
		const manager = ctx.sessionManager;
		const session = ctx.session;
		const sessionId = manager.getSessionId();
		let proposed: boolean;
		if (!arg) {
			const choice = await ctx.showHookCustom<number | undefined>(
				(ui, _theme, _keys, done) =>
					new ConnectionChoiceComponent(
						"Fast mode",
						`Current session: ${ctx.session.isFastModeEnabled() ? "on" : "off"}`,
						[{ label: "Cancel" }, { label: "Enable fast mode" }, { label: "Disable fast mode" }],
						done,
						() => done(undefined),
						() => ui.terminal.rows,
					),
			);
			if (!choice) return;
			proposed = choice === 1;
		} else proposed = arg === "toggle" ? !ctx.session.isFastModeEnabled() : arg === "on";
		if (ctx.sessionManager !== manager || ctx.session !== session || manager.getSessionId() !== sessionId) {
			ctx.showError("Session changed. Run /fast again.");
			return;
		}
		const pending = unresolved.get(manager);
		if (
			session.isFastModeEnabled() === proposed &&
			!(pending?.sessionId === sessionId && pending.proposed === proposed)
		) {
			ctx.showStatus(`Fast mode is already ${proposed ? "on" : "off"}; nothing changed.`);
			return;
		}
		const review = (): ActionReview => ({
			identity: `session:${sessionId}`,
			scope: "Current session · Recorded in session history; global defaults unchanged",
			revision: String(ctx.session.serviceTier ?? "default"),
			changes: [
				{
					field: "Service tier",
					before: String(ctx.session.serviceTier ?? "default"),
					after: proposed ? "priority" : "default",
				},
			],
			consequence:
				"Applies to subsequent supported requests. Priority service may cost more; provider support determines its effect.",
		});
		const outcome = await runReviewedAction(ctx, "fast mode", {
			review: review(),
			resolve: async () =>
				ctx.sessionManager === manager && ctx.session === session && manager.getSessionId() === sessionId
					? { review: review(), target: session }
					: undefined,
			execute: async target => {
				unresolved.set(manager, { sessionId, proposed });
				if (target.isFastModeEnabled() !== proposed) target.setFastMode(proposed);
				await manager.retryPersistence();
				if (
					ctx.sessionManager !== manager ||
					ctx.session !== session ||
					manager.getSessionId() !== sessionId ||
					target.isFastModeEnabled() !== proposed
				)
					throw new Error("Fast mode did not reach the requested state.");
				unresolved.delete(manager);
			},
		});
		if (outcome === "succeeded") {
			ctx.statusLine.invalidate();
			ctx.updateEditorTopBorder();
			ctx.ui.requestRender();
			ctx.showStatus(`Fast mode ${proposed ? "enabled" : "disabled"} for this session.`);
		}
		if (outcome === "unresolved")
			ctx.showError(
				"Fast-mode saving was not confirmed. State may already have changed; retry the command to resolve persistence.",
			);
	} catch (error) {
		ctx.showError(error instanceof Error ? error.message : String(error));
	} finally {
		active.delete(ctx);
	}
}
