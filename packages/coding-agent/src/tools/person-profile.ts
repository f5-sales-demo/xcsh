import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@f5-sales-demo/pi-agent-core";
import { prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { FieldSchema, PersonFactsSchema, type PersonProfile, PropertyIdSchema } from "../person-profile/schema";
import { personProfileService } from "../person-profile/service";
import personProfileToolTemplate from "../prompts/tools/person-profile.md" with { type: "text" };
import { isRemoteAsk } from "../sandbox/remote-permissions";
import type { ToolSession } from "./index";
import { enforcePlanModeWrite } from "./plan-mode-guard";

const schema = Type.Object(
	{
		action: Type.Union([
			Type.Literal("get"),
			Type.Literal("update"),
			Type.Literal("refresh"),
			Type.Literal("forget"),
			Type.Literal("observe"),
			Type.Literal("sources"),
		]),
		facts: Type.Optional(PersonFactsSchema),
		source: Type.Optional(Type.String({ pattern: "^[a-z][a-z0-9_-]{0,63}$" })),
		kind: Type.Optional(Type.Union([Type.Literal("observed"), Type.Literal("inferred")])),
		fields: Type.Optional(Type.Array(FieldSchema, { minItems: 1, maxItems: 100 })),
		propertyIds: Type.Optional(
			Type.Array(PropertyIdSchema, {
				minItems: 1,
				maxItems: 100,
				description:
					"Forget individual xcsh-specific personal attributes by propertyID without deleting unrelated attributes",
			}),
		),
		sources: Type.Optional(Type.Array(Type.String({ pattern: "^[a-z][a-z0-9_-]{0,63}$" }), { maxItems: 32 })),
		configure: Type.Optional(
			Type.Boolean({
				description: "Enable subsequent background reconciliation for the explicitly selected refresh sources",
			}),
		),
		revision: Type.Optional(Type.Integer({ minimum: 0 })),
	},
	{ additionalProperties: false },
);
export class PersonProfileTool implements AgentTool<typeof schema> {
	readonly name = "person_profile";
	readonly strict = false;
	readonly label = "Person profile";
	readonly description = prompt.render(personProfileToolTemplate);
	readonly parameters = schema;
	constructor(private readonly session: ToolSession) {}
	async execute(
		_id: string,
		args: Static<typeof schema>,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback,
		context?: AgentToolContext,
	): Promise<AgentToolResult<unknown>> {
		if (!Value.Check(schema, args)) throw new Error("Invalid person profile operation");
		const service = this.session.personProfileService ?? personProfileService;
		if (args.action === "sources") {
			const sources = service.listCollectors();
			return {
				content: [{ type: "text", text: JSON.stringify({ sources }) }],
				details: { sourceCount: sources.length },
			};
		}
		if (args.action !== "get") {
			enforcePlanModeWrite(this.session, service.path);
			if (args.revision === undefined)
				throw new Error("Person profile revision required; get the current profile first");
		}
		if (args.action !== "get" && isRemoteAsk(this.session.settings)) {
			if (signal?.aborted) throw new Error("Person profile operation cancelled");
			if (!context?.hasUI || !context.ui) throw new Error("Person profile approval unavailable");
			const proposal =
				args.action === "observe"
					? { facts: args.facts, source: args.source, kind: args.kind }
					: args.action === "update"
						? args.facts
						: args.action === "forget"
							? { fields: args.fields, propertyIds: args.propertyIds }
							: { sources: args.sources, configure: args.configure ?? false };
			const choice = await context.ui.select(
				`Approve person profile ${args.action}: ${JSON.stringify(proposal)}`,
				["Allow once", "Decline"],
				{
					signal,
				},
			);
			if (signal?.aborted) throw new Error("Person profile operation cancelled");
			if (choice !== "Allow once") throw new Error("Person profile operation declined");
		}
		let result: PersonProfile;
		const canCommit = () => !this.session.getPlanModeState?.()?.enabled;
		if (args.action !== "get") enforcePlanModeWrite(this.session, service.path);
		switch (args.action) {
			case "get":
				result = await service.get();
				break;
			case "update":
				if (!args.facts) throw new Error("Person profile facts required");
				result = await service.update(args.facts, args.revision, signal, canCommit);
				break;
			case "observe":
				if (!args.facts || !args.source || !args.kind)
					throw new Error("Person profile evidence, source and kind required");
				result = await service.observe(
					Object.entries(args.facts).map(([field, value]) => ({
						field: field as keyof typeof args.facts,
						value,
						source: args.source!,
						kind: args.kind!,
						observedAt: new Date().toISOString(),
					})),
					args.revision,
					signal,
					canCommit,
				);
				break;
			case "forget":
				result = await service.forget(args.fields ?? [], args.revision, signal, canCommit, args.propertyIds);
				break;
			case "refresh":
				result = await service.refresh(
					args.sources ?? service.listCollectors().map(c => c.id),
					args.revision,
					signal,
					args.configure,
					canCommit,
				);
				break;
		}
		return {
			content: [{ type: "text", text: JSON.stringify(result) }],
			details: { schemaVersion: result.schemaVersion, revision: result.revision, state: result.state },
		};
	}
}
