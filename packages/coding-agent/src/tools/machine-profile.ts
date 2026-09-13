import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5-sales-demo/pi-agent-core";
import { prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { machineProfileService } from "../person-profile/machine-profile";
import template from "../prompts/tools/machine-profile.md" with { type: "text" };
import { isRemoteAsk } from "../sandbox/remote-permissions";
import type { ToolSession } from "./index";
import { enforcePlanModeWrite } from "./plan-mode-guard";

const schema = Type.Object(
	{ action: Type.Union([Type.Literal("get"), Type.Literal("refresh")]) },
	{ additionalProperties: false },
);
export class MachineProfileTool implements AgentTool<typeof schema> {
	readonly name = "machine_profile";
	readonly label = "Machine profile";
	readonly description = prompt.render(template);
	readonly parameters = schema;
	constructor(private readonly session: ToolSession) {}
	async execute(
		_id: string,
		args: Static<typeof schema>,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback,
		context?: AgentToolContext,
	): Promise<AgentToolResult<unknown>> {
		if (!Value.Check(schema, args)) throw new Error("Invalid machine profile operation");
		const service = this.session.machineProfileService ?? machineProfileService;
		if (args.action === "refresh") {
			enforcePlanModeWrite(this.session, service.path);
			if (isRemoteAsk(this.session.settings)) {
				if (!context?.hasUI || !context.ui) throw new Error("Machine profile approval unavailable");
				const choice = await context.ui.select(
					"Refresh local machine hardware, OS, tools and management observations?",
					["Allow once", "Decline"],
					{ signal },
				);
				if (signal?.aborted) throw new Error("Machine profile operation cancelled");
				if (choice !== "Allow once") throw new Error("Machine profile operation declined");
			}
			enforcePlanModeWrite(this.session, service.path);
		}
		const result =
			args.action === "get"
				? await service.get()
				: await service.refresh(signal, 0, () => !this.session.getPlanModeState?.()?.enabled);
		return {
			content: [{ type: "text", text: JSON.stringify(result) }],
			details: { schemaVersion: result.schemaVersion, revision: result.revision, state: result.state },
		};
	}
}
