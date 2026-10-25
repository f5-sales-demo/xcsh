import type { AgentTool, AgentToolResult } from "@f5-sales-demo/pi-agent-core";
import { prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import template from "../prompts/tools/enter-plan-mode.md" with { type: "text" };
import persistenceTemplate from "../prompts/tools/plan-mode-persistence-result.md" with { type: "text" };
import type { ToolSession } from ".";

const schema = Type.Object(
	{ action: Type.Union([Type.Literal("enter"), Type.Literal("status")]) },
	{ additionalProperties: false },
);

export class EnterPlanModeTool implements AgentTool<typeof schema> {
	readonly name = "enter_plan_mode";
	readonly label = "Plan mode";
	readonly strict = false;
	readonly parameters = schema;
	readonly description = prompt.render(template);
	constructor(private readonly session: ToolSession) {}
	static createIf(session: ToolSession): EnterPlanModeTool | null {
		return session.enterPlanMode && session.getPlanModeState ? new EnterPlanModeTool(session) : null;
	}
	getOperationEffect(args: unknown): "readOnly" | "mutation" {
		return (args as { action?: string })?.action === "status" ? "readOnly" : "mutation";
	}
	async execute(_id: string, args: Static<typeof schema>, signal?: AbortSignal): Promise<AgentToolResult<unknown>> {
		if (!Value.Check(schema, args)) throw new Error("Invalid Plan mode operation");
		signal?.throwIfAborted();
		if (args.action === "enter" && !this.session.getPlanModeState?.()?.enabled) {
			if (!this.session.enterPlanMode) throw new Error("Plan mode control is unavailable");
			await this.session.enterPlanMode();
		}
		signal?.throwIfAborted();
		const enabled = this.session.getPlanModeState?.()?.enabled === true;
		if (args.action === "enter" && !enabled) throw new Error("Plan mode was not applied by the runtime");
		const result = { mode: enabled ? "plan" : "default" };
		return {
			content: [
				{ type: "text", text: JSON.stringify(result) },
				...(enabled ? [{ type: "text" as const, text: prompt.render(persistenceTemplate).trim() }] : []),
			],
			details: result,
		};
	}
}
