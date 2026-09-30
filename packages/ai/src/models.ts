import { applyCodexInteractionMetadata, CODEX_MODEL_INTERACTION_METADATA } from "./codex-model-interaction";
import { applyGeneratedModelPolicies, enrichModelThinking } from "./model-thinking";
import MODELS from "./models.json" with { type: "json" };
import { mirrorCloudflareWorkersModels } from "./providers/cloudflare-route";
import { currentSolModels } from "./sol-model";
import type { Api, KnownProvider, Model, Usage } from "./types";

/**
 * Static bundled model registry loaded from `models.json`.
 *
 * This module intentionally exposes compile-time defaults only.
 * It does not include runtime discovery, models.dev overlays, or on-disk cache state.
 *
 * For runtime-aware resolution, use `createModelManager()` / `resolveProviderModels()`.
 */
const modelRegistry: Map<string, Map<string, Model<Api>>> = new Map();
for (const [provider, models] of Object.entries(MODELS)) {
	const providerModels = new Map<string, Model<Api>>();
	for (const [id, model] of Object.entries(models)) {
		const normalized = [model as Model<Api>];
		if (provider === "xai" || provider === "xiaomi" || provider === "fireworks")
			applyGeneratedModelPolicies(normalized, { preserveDiscoveredThinking: true });
		providerModels.set(
			id,
			applyCodexInteractionMetadata({
				...enrichModelThinking(normalized[0]!),
				...(provider === "openai-codex" && CODEX_MODEL_INTERACTION_METADATA[id] ? { thinking: undefined } : {}),
			}),
		);
	}
	modelRegistry.set(provider, providerModels);
}
for (const model of currentSolModels()) {
	modelRegistry.get(model.provider)?.set(model.id, applyCodexInteractionMetadata(enrichModelThinking(model)));
}

export type GeneratedProvider = keyof typeof MODELS;
const cloudflareModels = [
	...(modelRegistry.get("cloudflare-workers-ai")?.values() ?? []),
	...(modelRegistry.get("cloudflare-ai-gateway")?.values() ?? []),
];
mirrorCloudflareWorkersModels(cloudflareModels);
for (const model of cloudflareModels) modelRegistry.get(model.provider)?.set(model.id, model);

export function getBundledModel(provider: GeneratedProvider, modelId: string): Model<Api> {
	const providerModels = modelRegistry.get(provider);
	return providerModels?.get(modelId) as Model<Api>;
}

export function getBundledProviders(): KnownProvider[] {
	return Array.from(modelRegistry.keys()) as KnownProvider[];
}

export function getBundledModels(provider: GeneratedProvider): Model<Api>[] {
	const models = modelRegistry.get(provider);
	return models ? (Array.from(models.values()) as Model<Api>[]) : [];
}

export function calculateCost<TModel extends Pick<Model, "cost"> & { provider?: string }>(
	model: TModel,
	usage: Usage,
): Usage["cost"] {
	usage.costKnown = model.cost.pricingKnown !== false;
	usage.billing =
		model.provider === "litellm"
			? "internal"
			: ["openai-codex", "google-gemini-cli", "google-antigravity"].includes(model.provider ?? "") ||
					usage.billing === "subscription"
				? "subscription"
				: "api";
	const totalInput = usage.input + usage.cacheRead + usage.cacheWrite;
	let rates = model.cost;
	let threshold = -1;
	for (const tier of model.cost.tiers ?? []) {
		if (totalInput > tier.inputTokensAbove && tier.inputTokensAbove > threshold) {
			rates = tier;
			threshold = tier.inputTokensAbove;
		}
	}
	usage.cost.input = (rates.input / 1000000) * usage.input;
	usage.cost.output = (rates.output / 1000000) * usage.output;
	usage.cost.cacheRead = (rates.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = (rates.cacheWrite / 1000000) * usage.cacheWrite;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}
/**
 * Check if two models are equal by comparing both their id and provider.
 * Returns false if either model is null or undefined.
 */
export function modelsAreEqual<TApi extends Api>(
	a: Model<TApi> | null | undefined,
	b: Model<TApi> | null | undefined,
): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}
