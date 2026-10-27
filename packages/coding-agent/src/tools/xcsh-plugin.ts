import { isDeepStrictEqual } from "node:util";
import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5-sales-demo/pi-agent-core";
import { prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import template from "../prompts/tools/xcsh-plugin.md" with { type: "text" };
import { isRemoteAsk, isRemoteReadOnly } from "../sandbox/remote-permissions";
import { PluginWorkflowService } from "../services/plugin-workflow";
import type { ToolSession } from "./index";

const name = Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9-]*$" });
const schema = Type.Object(
	{
		action: Type.Union([
			Type.Literal("catalogs"),
			Type.Literal("list"),
			Type.Literal("plan"),
			Type.Literal("install"),
		]),
		plugin: Type.Optional(name),
		marketplace: Type.Optional(name),
		scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("user")])),
	},
	{ additionalProperties: false },
);

export class XcshPluginTool implements AgentTool<typeof schema> {
	readonly name = "xcsh_plugin";
	readonly label = "Plugins";
	readonly strict = false;
	readonly concurrency = "exclusive";
	readonly parameters = schema;
	readonly description = prompt.render(template);
	constructor(private readonly session: ToolSession) {}
	getOperationEffect(args: unknown): "readOnly" | "mutation" {
		return (args as { action?: string })?.action === "install" ? "mutation" : "readOnly";
	}
	async execute(
		_id: string,
		args: Static<typeof schema>,
		signal?: AbortSignal,
		_update?: AgentToolUpdateCallback,
		context?: AgentToolContext,
	): Promise<AgentToolResult<unknown>> {
		if (!Value.Check(schema, args) || (["plan", "install"].includes(args.action) && !args.plugin)) {
			throw new Error(
				"Invalid plugin operation; plan/install require plugin and marketplace, and context selection uses xcsh_context",
			);
		}
		const preferredCatalog = this.session.settings.get("marketplace.preferredCatalog");
		if (typeof preferredCatalog === "string" && args.marketplace && args.marketplace !== preferredCatalog)
			throw new Error("Requested marketplace conflicts with the configured catalog");
		const marketplace = args.marketplace ?? (typeof preferredCatalog === "string" ? preferredCatalog : undefined);
		if (["plan", "install"].includes(args.action) && !marketplace)
			throw new Error("Select a registered marketplace from catalogs before planning installation");
		const selectedEnvironment = {
			...((this.session.settings.get("bash.environment") ?? {}) as Record<string, string>),
		};
		const service = this.session.getPluginWorkflowService
			? await this.session.getPluginWorkflowService()
			: await PluginWorkflowService.create(this.session.cwd, selectedEnvironment);
		const scope = args.scope ?? "project";
		const finish = (value: unknown) => ({
			content: [{ type: "text" as const, text: JSON.stringify(value) }],
			details: value,
		});
		if (signal?.aborted) throw new Error("Plugin operation cancelled");
		if (args.action === "catalogs") return finish(await service.catalogs());
		if (args.action === "list") return finish(await service.list(scope));
		const plan = await service.plan(args.plugin!, marketplace!, scope);
		if (args.action === "plan") return finish(plan);
		if (plan.changes.length === 0)
			return finish({ state: "already-installed", changed: false, dependencyPlan: plan.dependencyPlan });
		if (plan.changes.some(change => change.action === "repair-required"))
			throw new Error(
				"Installed plugin integrity failed; preserve the installation and repair its cache before retrying",
			);
		const guard = () => {
			if (!isDeepStrictEqual(selectedEnvironment, this.session.settings.get("bash.environment") ?? {}))
				throw new Error("Plugin installation environment changed after review");
			if (signal?.aborted) throw new Error("Plugin installation cancelled");
			if (this.session.getPlanModeState?.()?.enabled || isRemoteReadOnly(this.session.settings))
				throw new Error("Read-only/Plan mode: plugin installation cannot change");
		};
		guard();
		if (isRemoteAsk(this.session.settings)) {
			if (!context?.hasUI || !context.ui) throw new Error("Plugin installation approval unavailable");
			const choice = await context.ui.select(
				`Install ${plan.plugin}@${plan.marketplace} in ${plan.scope} scope\n${plan.dependencyPlan.map(item => `${item.pluginId} ${item.version}`).join(" → ")}\nApply this installation and its declared install-authorized prerequisites. Separate deployment/setup remains unapproved.`,
				["Allow once", "Decline"],
				{ signal },
			);
			guard();
			if (choice !== "Allow once") throw new Error("Plugin installation declined");
		}
		const current = await service.plan(args.plugin!, marketplace!, scope);
		if (current.fingerprint !== plan.fingerprint)
			throw new Error("Plugin installation plan changed after review; inspect the new plan before approving");
		guard();
		const result = await service.install(current, signal);
		if (result.changed) await this.session.reloadPluginTools?.();
		return finish(result);
	}
}
