import type { AgentTool, AgentToolResult } from "@f5-sales-demo/pi-agent-core";
import { prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import template from "../prompts/tools/xcsh-blindfold.md" with { type: "text" };
import { BLINDFOLD_OPERATIONS, BlindfoldService } from "../services/blindfold";
import { currentContextExecution } from "../services/context-execution";
import { ContextService } from "../services/xcsh-context";
import type { ToolSession } from "./index";

export const blindfoldSchema = Type.Object(
	{
		operation: Type.Union(BLINDFOLD_OPERATIONS.map(v => Type.Literal(v))),
		file: Type.Optional(Type.String()),
		input: Type.Optional(Type.String()),
		publicKey: Type.Optional(Type.String()),
		policyDocument: Type.Optional(Type.String()),
		cert: Type.Optional(Type.String()),
		key: Type.Optional(Type.String()),
		bundle: Type.Optional(Type.String()),
		name: Type.Optional(Type.String()),
		namespace: Type.Optional(Type.String()),
		policy: Type.Optional(Type.String()),
		passphraseEnv: Type.Optional(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" })),
		contextName: Type.Optional(Type.String()),
		outputFile: Type.Optional(Type.String()),
		resultFile: Type.Optional(Type.String()),
		dryRun: Type.Optional(Type.Literal("client")),
	},
	{ additionalProperties: false },
);
/** File paths only: private inputs and encrypted results never become model content. */
export class XcshBlindfoldTool implements AgentTool<typeof blindfoldSchema> {
	readonly name = "xcsh_blindfold";
	readonly label = "Blindfold";
	readonly strict = false;
	readonly concurrency = "exclusive";
	readonly description = prompt.render(template);
	readonly parameters = blindfoldSchema;
	constructor(private readonly session: ToolSession) {}
	async execute(
		_id: string,
		args: Static<typeof blindfoldSchema>,
		signal?: AbortSignal,
	): Promise<AgentToolResult<unknown>> {
		if (!Value.Check(blindfoldSchema, args))
			throw new Error("Invalid Blindfold arguments; supply file paths and a passphrase environment name only");
		if ((args.operation === "encrypt" || args.operation === "certificate") && !args.outputFile)
			throw new Error(
				"Blindfold preparation requires outputFile so encrypted material is retained outside tool results",
			);
		if (args.operation === "encrypt" && (!args.input || args.input === "-"))
			throw new Error("Assistant encryption requires an input file path");
		if (Boolean(args.publicKey) !== Boolean(args.policyDocument))
			throw new Error("Public key and policy document paths must be supplied together");
		const offline = Boolean(args.publicKey && args.policyDocument);
		const admitted = offline ? undefined : currentContextExecution();
		const context =
			offline || admitted
				? undefined
				: this.session.getContextService
					? await this.session.getContextService()
					: await ContextService.getOrInit(undefined, this.session.cwd);
		const snapshot = context?.getStatus();
		const env = offline
			? {}
			: admitted
				? admitted.environment
				: {
						...(this.session.settings.get("bash.environment") as Record<string, string> | undefined),
						...process.env,
					};
		const credentialSnapshot = env.XCSH_API_TOKEN;
		const namespaceSnapshot = env.XCSH_NAMESPACE;
		const guard = () => {
			const current = context?.getStatus();
			const now = offline
				? {}
				: admitted
					? admitted.environment
					: {
							...(this.session.settings.get("bash.environment") as Record<string, string> | undefined),
							...process.env,
						};
			if (now.XCSH_API_TOKEN !== credentialSnapshot || now.XCSH_NAMESPACE !== namespaceSnapshot)
				throw new Error("Blindfold context credentials or namespace changed; retry against the selected context");
			if (
				current?.activeContextName !== snapshot?.activeContextName ||
				current?.activeContextUrl !== snapshot?.activeContextUrl
			)
				throw new Error("Blindfold context changed; retry against the selected context");
			if (
				this.session.getPlanModeState?.()?.enabled &&
				(args.outputFile ||
					args.resultFile ||
					args.operation === "create" ||
					args.operation === "replace" ||
					args.operation === "ensure")
			)
				throw new Error("Plan mode: Blindfold deployments and artifact writes are blocked");
		};
		guard();
		const report = await new BlindfoldService({ env, cwd: this.session.cwd }).run(args, {
			signal,
			guard,
			planMode: this.session.getPlanModeState?.()?.enabled,
		});
		return { content: [{ type: "text", text: JSON.stringify(report) }], details: report };
	}
}
