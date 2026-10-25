import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5-sales-demo/pi-agent-core";
import { prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import template from "../prompts/tools/xcsh-context.md" with { type: "text" };
import { ContextError, ContextService } from "../services/xcsh-context";
import type { ToolSession } from "./index";

const schema = Type.Object(
	{
		action: Type.Union([Type.Literal("list"), Type.Literal("status"), Type.Literal("activate")]),
		name: Type.Optional(Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-zA-Z0-9_-]+$" })),
	},
	{ additionalProperties: false },
);

/** Conversational adapter to the same runtime selection used by /context. */
export class XcshContextTool implements AgentTool<typeof schema> {
	readonly name = "xcsh_context";
	readonly label = "Tenant context";
	readonly strict = false;
	readonly concurrency = "exclusive";
	readonly description = prompt.render(template);
	readonly parameters = schema;
	getOperationEffect(args: unknown): "readOnly" | "mutation" {
		const action = (args as { action?: string })?.action;
		return ["list", "status"].includes(action ?? "") ? "readOnly" : "mutation";
	}
	constructor(private readonly session: ToolSession) {}

	async execute(
		_id: string,
		args: Static<typeof schema>,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<unknown>> {
		if (!Value.Check(schema, args) || (args.action === "activate" && !args.name)) {
			throw new Error("Invalid context operation; activation requires a saved context name");
		}
		const guard = () => {
			if (signal?.aborted) throw new Error("Context selection cancelled");
			if (this.session.getPlanModeState?.()?.enabled) throw new Error("Plan mode: context selection cannot change");
		};
		if (args.action === "activate") guard();
		try {
			const service = this.session.getContextService
				? await this.session.getContextService()
				: await ContextService.getOrInit(undefined, this.session.cwd);
			if (args.action === "list") {
				const contexts = (await service.listContexts()).map(value => ({
					name: value.name,
					apiUrl: value.apiUrl,
					namespace: value.defaultNamespace,
				}));
				return {
					content: [{ type: "text", text: JSON.stringify({ contexts }) }],
					details: { contextCount: contexts.length },
				};
			}
			if (args.action === "activate") {
				const target = service.prepareActivation(args.name!);
				if (service.isCurrentActivation?.(target, this.session.cwd)) {
					await service.validateToken({ timeoutMs: 5000 });
					guard();
					if (!service.isCurrentActivation(target, this.session.cwd))
						throw new ContextError("Context changed during validation");
					const status = { ...service.getStatus(), workspace: this.session.cwd };
					if (status.authStatus === "connected") this.session.adoptActivatedContext?.(target.name);
					return { content: [{ type: "text", text: JSON.stringify(status) }], details: status };
				}
				await service.activate(target.name, { revision: target.revision, beforeCommit: guard });
				await service.validateToken({ timeoutMs: 5000 });
				if (signal?.aborted)
					throw new ContextError("Context selection cancelled after activation; inspect status before continuing");
				if (service.getStatus().activeContextName !== target.name) {
					throw new ContextError("Context changed during validation; inspect status before querying resources");
				}
				if (service.getStatus().authStatus === "connected") this.session.adoptActivatedContext?.(target.name);
			}
			const status = { ...service.getStatus(), workspace: this.session.cwd };
			return { content: [{ type: "text", text: JSON.stringify(status) }], details: status };
		} catch (error) {
			if (error instanceof ContextError) throw error;
			if (signal?.aborted) throw new Error("Context selection cancelled");
			if (this.session.getPlanModeState?.()?.enabled && args.action === "activate") {
				throw new Error("Plan mode: context selection cannot change");
			}
			throw new Error("Context operation failed; inspect /context status and the saved context configuration");
		}
	}
}
