import { createThinkingConfig, type Model, ReasoningEffort } from "@f5-sales-demo/pi-ai";
import type { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";

/** Synthetic catalog matching the six routes reported by the internal gateway user. */
export const liteLLMFixtureModels: Model[] = [
	["anthropic", "claude-opus-5", "Claude Opus 5"],
	["anthropic", "claude-sonnet-5", "Claude Sonnet 5"],
	["anthropic", "claude-haiku-4-5", "Claude Haiku 4.5"],
	["litellm", "gpt-5.6-terra", "GPT-5.6 Terra"],
	["litellm", "gpt-5.6-luna", "GPT-5.6 Luna"],
	["litellm", "gpt-5.6-sol", "GPT-5.6 Sol"],
].map(([provider, id, name]) => ({
	provider,
	id,
	name,
	api: provider === "anthropic" ? "anthropic-messages" : "openai-completions",
	baseUrl: "https://gateway.example.test",
	reasoning: true,
	input: ["text"],
	contextWindow: 200000,
	maxTokens: 8192,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	thinking: createThinkingConfig([ReasoningEffort.Low, ReasoningEffort.Medium, ReasoningEffort.High]),
})) as Model[];

export function providerSelectorFixture() {
	const models = [...liteLLMFixtureModels];
	const settings = Settings.isolated({
		modelRoles: {
			default: "litellm/gpt-5.6-terra:medium",
			smol: "litellm/gpt-5.6-luna:low",
			slow: "litellm/gpt-5.6-sol:high",
			plan: "litellm/gpt-5.6-sol:high",
		},
	});
	const registry = {
		getAll: () => models,
		getAvailable: () => models,
		getError: () => undefined,
		getProviderInventory: () => ["litellm", "anthropic"],
		getConfiguredProviderIds: () => new Set(["litellm", "anthropic"]),
		getDiscoverableProviders: () => [],
		getProviderPickerMetadata: (provider: string) => ({
			groupId: "litellm",
			groupLabel: "LiteLLM",
			sectionLabel: provider === "anthropic" ? "Anthropic" : "OpenAI",
		}),
		getProviderAccessState: (provider: string) => ({
			provider,
			configured: true,
			credentialSource: "configuration",
			status: "connected",
			catalogFreshness: "fresh",
			selectable: true,
		}),
		getProviderDiscoveryState: (provider: string) => ({
			provider,
			status: "ok",
			stale: false,
			optional: false,
			models: models.filter(model => model.provider === provider).map(model => model.id),
		}),
		authStorage: { hasAuth: () => true },
	} as unknown as ModelRegistry;
	return { models, settings, registry, active: models[5] };
}
