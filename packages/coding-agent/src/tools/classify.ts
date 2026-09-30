import type { AgentTool } from "@f5-sales-demo/pi-agent-core";
import {
	type ClassifierContext,
	type ClassifierModel,
	type ClassifierResult,
	classify,
	getBundledClassifierModel,
} from "@f5-sales-demo/pi-ai";
import { prompt } from "@f5-sales-demo/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import description from "../prompts/tools/classify.md" with { type: "text" };
import type { ToolSession } from "./index";

const question = Type.Union([
	Type.Object({
		type: Type.Literal("choice"),
		instructions: Type.String(),
		criteria: Type.Record(Type.String(), Type.String()),
	}),
	Type.Object({ type: Type.Literal("score"), instructions: Type.String(), criteria: Type.Array(Type.String()) }),
	Type.Object({
		type: Type.Literal("bool"),
		instructions: Type.String(),
		criteria: Type.Object({ true: Type.String(), false: Type.String() }),
	}),
]);
const schema = Type.Object({
	provider: Type.String(),
	model: Type.String(),
	state: Type.Record(Type.String(), Type.Unknown()),
	questions: Type.Record(Type.String(), question),
});

export class ClassifyTool implements AgentTool<typeof schema, ClassifierResult> {
	readonly name = "classify";
	readonly label = "Classify";
	readonly description = prompt.render(description);
	readonly parameters = schema;
	readonly strict = true;
	constructor(private readonly session: ToolSession) {}
	async execute(_id: string, params: Static<typeof schema>, signal?: AbortSignal) {
		let model =
			this.session.modelRegistry?.getClassifierModels?.(params.provider).find(model => model.id === params.model) ??
			getBundledClassifierModel(params.provider, params.model);
		if (!model && this.session.modelRegistry) {
			await this.session.modelRegistry.refreshOperationModels(params.provider, signal);
			model = this.session.modelRegistry
				.getClassifierModels(params.provider)
				.find(model => model.id === params.model);
		}
		if (!model && params.provider === "llama.cpp") {
			const chat = this.session.modelRegistry?.find(params.provider, params.model);
			if (chat) model = { ...chat, type: "classifier", api: "llama-cpp-classify" } as ClassifierModel;
		}
		if (!model) throw new Error(`Classifier model not found: ${params.provider}/${params.model}`);
		const apiKey = await this.session.modelRegistry?.getApiKeyForProvider(params.provider);
		const result = await classify(model, { state: params.state, questions: params.questions } as ClassifierContext, {
			apiKey,
			signal,
		});
		if (result.stopReason !== "stop") throw new Error(result.errorMessage ?? "Classification failed");
		return { content: [{ type: "text" as const, text: JSON.stringify(result.answers) }], details: result };
	}
}
