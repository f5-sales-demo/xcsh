import type { Model, ModelCost, ThinkingConfig } from "./types";

/** Official API contract; account availability always comes from discovery/authentication. */
export const SOL_MODEL_ID = "gpt-6.1-sol";
export const SOL_API_COST: ModelCost = {
	input: 2,
	output: 10,
	cacheRead: 0.1,
	cacheWrite: 2.5,
	tiers: [{ inputTokensAbove: 272_000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }],
};
export const SOL_API_THINKING: ThinkingConfig = {
	mode: "effort",
	defaultLevel: "medium",
	supportedLevels: ["low", "medium", "high", "xhigh", "max"].map(effort => ({
		effort: effort as "low" | "medium" | "high" | "xhigh" | "max",
		description: `${effort} reasoning`,
	})),
};

export function currentSolModels(): Model[] {
	return ["openai", "openai-codex", "litellm"].map(provider => ({
		id: SOL_MODEL_ID,
		name: "GPT-6.1 Sol",
		provider,
		api: provider === "openai-codex" ? "openai-codex-responses" : "openai-responses",
		baseUrl:
			provider === "openai-codex"
				? "https://chatgpt.com/backend-api"
				: provider === "openai"
					? "https://api.openai.com/v1"
					: "",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: provider === "openai-codex" ? 272_000 : 1_050_000,
		maxInputTokens: 922_000,
		maxTokens: 128_000,
		cost: provider === "openai" ? SOL_API_COST : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		thinking:
			provider === "openai-codex"
				? {
						...SOL_API_THINKING,
						supportedLevels: [
							...SOL_API_THINKING.supportedLevels,
							{ effort: "ultra", description: "Ultra reasoning" },
						],
					}
				: SOL_API_THINKING,
		compat:
			provider === "openai"
				? {
						supportsExplicitPromptCacheMode: true,
						supportsAdditionalTools: true,
						supportsToolSearch: true,
						supportsOpenAIGrammarTools: true,
						supportsCachedReasoningUpdates: true,
					}
				: undefined,
		defaultServiceTier: "default",
		serviceTiers: ["default", "priority"],
		...(provider === "openai-codex" ? { preferWebsockets: true } : {}),
	}));
}

/** Apply after payload hooks so extensions cannot reintroduce rejected sampling fields. */
export function sanitizeSolRequest(model: Pick<Model, "id" | "provider">, body: Record<string, unknown>): void {
	if (model.id !== SOL_MODEL_ID && model.provider !== "openai-codex") return;
	for (const field of [
		"temperature",
		"top_p",
		"top_k",
		"min_p",
		"presence_penalty",
		"frequency_penalty",
		"repetition_penalty",
		"logprobs",
		"top_logprobs",
	])
		delete body[field];
	const reasoning = body.reasoning as Record<string, unknown> | undefined;
	if (reasoning?.summary === "none") delete reasoning.summary;
	if (model.id === SOL_MODEL_ID && reasoning?.effort !== undefined) {
		const allowed =
			model.provider === "openai-codex"
				? ["low", "medium", "high", "xhigh", "max", "ultra"]
				: ["low", "medium", "high", "xhigh", "max"];
		if (!allowed.includes(String(reasoning.effort)))
			throw new Error(`Reasoning effort ${reasoning.effort} is not supported by ${model.provider}/${model.id}`);
	}
}
