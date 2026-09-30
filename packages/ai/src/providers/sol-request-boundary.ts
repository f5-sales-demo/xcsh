import { requireSupportedReasoningEffort } from "../model-thinking";
import { SOL_MODEL_ID, sanitizeSolRequest } from "../sol-model";
import type { Model } from "../types";
export function validateFinalResponsesRequest(model: Model, body: Record<string, unknown>): void {
	sanitizeSolRequest(model, body);
	const explicitCache =
		model.provider !== "openai-codex" &&
		(model.compat as import("../types").OpenAIResponsesCompat | undefined)?.supportsExplicitPromptCacheMode === true;
	if (!explicitCache) {
		delete body.prompt_cache_options;
		if (Array.isArray(body.input))
			for (const item of body.input) {
				if (!item || typeof item !== "object" || !Array.isArray(item.content)) continue;
				for (const content of item.content)
					if (content && typeof content === "object") delete content.prompt_cache_breakpoint;
			}
	}
	if (model.provider === "openai-codex") {
		body.store = false;
		body.stream = true;
		delete body.prompt_cache_retention;
		delete body.max_output_tokens;
		delete body.max_completion_tokens;
	}
	if (model.id !== SOL_MODEL_ID) return;
	const reasoning = body.reasoning as { effort?: import("../model-thinking").ReasoningEffort } | undefined;
	if (reasoning?.effort && model.thinking) requireSupportedReasoningEffort(model, reasoning.effort);
	const tier = body.service_tier;
	if (tier !== undefined && model.serviceTiers && !model.serviceTiers.includes(tier as never))
		throw new Error(`Service tier unavailable for ${model.provider}/${model.id}`);
}
