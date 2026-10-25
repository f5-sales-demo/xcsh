import type { Model } from "@f5-sales-demo/pi-ai";
import { filterCurrentBrowserModels } from "../config/model-catalog";
import { ModelRegistry } from "../config/model-registry";
import { defaultModelPerProvider, resolveModelRoleValue } from "../config/model-resolver";
import { Settings } from "../config/settings";
import { discoverAuthStorage } from "../sdk";
import { resolveThinkingLevelForModel, toReasoningEffort } from "../thinking";
import type { RemoteTaskSettings } from "./router";

/** Resolve host setup metadata from eligible models, without inventing a thread or worker. */
export function resolveRemoteTaskSettings(available: readonly Model[], settings: Settings): RemoteTaskSettings {
	const models = filterCurrentBrowserModels(available).filter(model => model.visibility !== "hide");
	const selected = resolveModelRoleValue(settings.getModelRole("default"), models, {
		settings,
		matchPreferences: { usageOrder: settings.getStorage()?.getModelUsageOrder() },
	});
	const model =
		selected.model ??
		models.find(
			model => defaultModelPerProvider[model.provider as keyof typeof defaultModelPerProvider] === model.id,
		) ??
		models[0];
	const thinking = model
		? resolveThinkingLevelForModel(
				model,
				selected.explicitThinkingLevel ? selected.thinkingLevel : settings.get("defaultThinkingLevel"),
				{ strictUnsupported: false },
			)
		: undefined;
	const candidates = model
		? [model, ...models.filter(item => item.provider === model.provider && item.id !== model.id)]
		: [];
	return {
		defaults: model
			? {
					model: model.id,
					modelProvider: model.provider,
					reasoningEffort: toReasoningEffort(thinking) ?? model.thinking?.defaultLevel ?? "none",
				}
			: undefined,
		models: candidates.map(model => ({
			id: model.id,
			provider: model.provider,
			displayName: model.name || model.id,
			description: model.description || `Available through ${model.provider}.`,
			supportedReasoningEfforts:
				model.thinking?.supportedLevels.map(level => ({
					reasoningEffort: level.effort,
					description: level.description,
				})) ?? [],
			defaultReasoningEffort: model.thinking?.defaultLevel ?? "none",
			inputModalities: (model.input ?? ["text"]).filter(
				(value): value is "text" | "image" => value === "text" || value === "image",
			),
		})),
	};
}

export async function loadRemoteTaskSettings(cwd: string): Promise<RemoteTaskSettings> {
	const settings = await Settings.init({ cwd });
	const auth = await discoverAuthStorage();
	try {
		const registry = new ModelRegistry(auth, undefined, {
			getProviderOrder: () => settings.get("modelProviderOrder"),
			getOpenAIContextTier: () => settings.get("providers.openaiContextTier"),
			getLiteLLMContextTier: () => settings.get("providers.litellmContextTier"),
		});
		await registry.refresh("online-if-uncached");
		return resolveRemoteTaskSettings(registry.getAvailable(), settings);
	} finally {
		auth.close();
	}
}
