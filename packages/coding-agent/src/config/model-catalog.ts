import type { Model } from "@f5-sales-demo/pi-ai";

function compareVersions(left: string, right: string): number {
	const leftParts = left.split(".").map(Number);
	const rightParts = right.split(".").map(Number);
	for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

/** Present the exact model-interaction contract when each provider advertises the model. */
const CODEX_INTERACTION_MODEL_IDS = new Set([
	"gpt-6.1-sol",
	"gpt-6-astra",
	"gpt-6-sol",
	"gpt-6-luna",
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gpt-5.5",
]);

/** Shared catalog boundary for the TUI and attached human interfaces. */
export function filterCurrentBrowserModels(models: readonly Model[]): Model[] {
	const newestGeminiVersion = new Map<string, string>();
	const newestClaudeVersion = new Map<string, string>();
	for (const model of models) {
		if (model.provider.startsWith("google-")) {
			const gemini = model.id.match(/^gemini-(\d+(?:\.\d+)?)-(flash|pro)(?:-|$)/i);
			if (gemini?.[1] && gemini[2]) {
				const key = `${model.provider}:${gemini[2].toLowerCase()}`;
				const previous = newestGeminiVersion.get(key);
				if (!previous || compareVersions(gemini[1], previous) > 0) newestGeminiVersion.set(key, gemini[1]);
			}
		}
		const claude = model.id.match(/^claude-(opus|sonnet|haiku)-(\d+)(?:[.-](\d+))?(?:-|$)/i);
		if (claude?.[1] && claude[2]) {
			const key = `${model.provider}:${claude[1].toLowerCase()}`;
			const version = `${claude[2]}.${claude[3] ?? "0"}`;
			const previous = newestClaudeVersion.get(key);
			if (!previous || compareVersions(version, previous) > 0) newestClaudeVersion.set(key, version);
		}
	}

	return models.filter(model => {
		const gpt = model.id.match(/^gpt-(\d+(?:\.\d+)?)(?:-|$)/i);
		if (gpt?.[1]) {
			if (model.provider === "openai-codex" || model.provider === "litellm") {
				return CODEX_INTERACTION_MODEL_IDS.has(model.id.toLowerCase());
			}
			if (compareVersions(gpt[1], "5.6") < 0) return false;
		}
		const claude = model.id.match(/^claude-(opus|sonnet|haiku)-(\d+)(?:[.-](\d+))?(?:-|$)/i);
		if (claude?.[1] && claude[2]) {
			const version = `${claude[2]}.${claude[3] ?? "0"}`;
			return newestClaudeVersion.get(`${model.provider}:${claude[1].toLowerCase()}`) === version;
		}
		if (!model.provider.startsWith("google-")) return true;
		if (!model.id.startsWith("gemini-"))
			return model.provider === "google-antigravity" && /^gpt-oss-/i.test(model.id);
		const match = model.id.match(/^gemini-(\d+(?:\.\d+)?)-(flash|pro)(?:-|$)/i);
		if (!match?.[1] || !match[2]) return false;
		return newestGeminiVersion.get(`${model.provider}:${match[2].toLowerCase()}`) === match[1];
	});
}
