import type { ReasoningEffort } from "./model-thinking";
import type { Api, Model, ServiceTier, ThinkingConfig } from "./types";

export type CodexContextTier = "standard" | "codex-max" | "provider-max";
export type ReasoningSummary = "none" | "auto" | "concise" | "detailed";
export type WireReasoningSummary = Exclude<ReasoningSummary, "none">;

export interface CodexModelInteractionMetadata {
	standardContextWindow: number;
	maxContextWindow: number;
	internalProviderMaxContextWindow: number;
	outputLimit: number;
	effectiveContextWindowPercent: number;
	autoCompactThresholdPercent: number;
	defaultReasoningSummary: ReasoningSummary;
	defaultVerbosity: "low" | "medium" | "high";
	thinking: ThinkingConfig;
	serviceTiers: ServiceTier[];
	defaultServiceTier: ServiceTier;
	truncationPolicy: { mode: "tokens" | "bytes"; limit: number };
	supportsParallelToolCalls: boolean;
	ultraReasoningEffort?: ReasoningEffort;
}

const descriptions: Record<ReasoningEffort, string> = {
	none: "No reasoning",
	minimal: "Minimal reasoning",
	low: "Light reasoning",
	medium: "Balanced reasoning",
	high: "Deep reasoning",
	xhigh: "Very deep reasoning",
	max: "Maximum reasoning",
	ultra: "Maximum reasoning with automatic task delegation",
};

function metadata(
	defaultLevel: ReasoningEffort,
	supported: ReasoningEffort[],
	defaultServiceTier: ServiceTier,
	maxContextWindow = 872_000,
	internalProviderMaxContextWindow = 1_050_000,
	ultraReasoningEffort: ReasoningEffort = "max",
): CodexModelInteractionMetadata {
	return {
		standardContextWindow: 272_000,
		maxContextWindow,
		internalProviderMaxContextWindow,
		outputLimit: 128_000,
		effectiveContextWindowPercent: 95,
		autoCompactThresholdPercent: 90,
		defaultReasoningSummary: "none",
		defaultVerbosity: "low",
		thinking: {
			mode: "effort",
			defaultLevel,
			supportedLevels: supported.map(effort => ({ effort, description: descriptions[effort] })),
		},
		serviceTiers: ["default", "priority"],
		defaultServiceTier,
		truncationPolicy: { mode: "tokens", limit: 10_000 },
		supportsParallelToolCalls: true,
		...(supported.includes("ultra") ? { ultraReasoningEffort } : {}),
	};
}

export const CODEX_MODEL_INTERACTION_METADATA: Readonly<Record<string, CodexModelInteractionMetadata>> = {
	"gpt-6-astra": metadata(
		"low",
		["low", "medium", "high", "xhigh", "max", "ultra"],
		"default",
		872_000,
		922_000,
		"xhigh",
	),
	"gpt-6-sol": metadata("medium", ["low", "medium", "high", "xhigh", "max", "ultra"], "priority", 872_000, 922_000),
	"gpt-6-luna": metadata("medium", ["low", "medium", "high", "xhigh", "max"], "priority", 872_000, 922_000),
	"gpt-5.6-sol": metadata("low", ["low", "medium", "high", "xhigh", "max", "ultra"], "default"),
	"gpt-5.6-terra": metadata("medium", ["low", "medium", "high", "xhigh", "max", "ultra"], "default"),
	"gpt-5.6-luna": metadata("medium", ["low", "medium", "high", "xhigh", "max"], "default"),
	"gpt-5.5": metadata("medium", ["low", "medium", "high", "xhigh"], "default", 272_000),
};

export function resolveCodexContextBudget(
	modelId: string,
	tier: CodexContextTier,
	providerContextWindow?: number,
): { contextWindow: number; effectiveContextWindow: number; autoCompactTokenLimit: number } | undefined {
	const interaction = CODEX_MODEL_INTERACTION_METADATA[modelId];
	if (!interaction) return undefined;
	const providerLimit =
		typeof providerContextWindow === "number" && Number.isFinite(providerContextWindow) && providerContextWindow > 0
			? Math.floor(providerContextWindow)
			: interaction.maxContextWindow;
	let contextWindow: number;
	if (tier === "standard") {
		contextWindow = Math.min(interaction.standardContextWindow, providerLimit);
	} else if (tier === "codex-max") {
		contextWindow = Math.min(interaction.maxContextWindow, providerLimit);
	} else {
		contextWindow = providerLimit;
	}
	return {
		contextWindow,
		effectiveContextWindow: Math.floor((contextWindow * interaction.effectiveContextWindowPercent) / 100),
		autoCompactTokenLimit: Math.floor((contextWindow * interaction.autoCompactThresholdPercent) / 100),
	};
}

export function resolveCodexWireReasoningEffort(modelId: string, effort: ReasoningEffort): ReasoningEffort {
	if (effort !== "ultra") return effort;
	return CODEX_MODEL_INTERACTION_METADATA[modelId]?.ultraReasoningEffort ?? "max";
}

export function resolveWireReasoningSummary(summary: ReasoningSummary): WireReasoningSummary | undefined {
	return summary === "none" ? undefined : summary;
}

/** Return the model's usable runtime context, clamped to its selected provider-facing window. */
export function getModelEffectiveContextWindow(model: Pick<Model, "contextWindow" | "effectiveContextWindow">): number {
	const contextWindow =
		typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow) && model.contextWindow > 0
			? Math.floor(model.contextWindow)
			: 0;
	const effectiveContextWindow =
		typeof model.effectiveContextWindow === "number" &&
		Number.isFinite(model.effectiveContextWindow) &&
		model.effectiveContextWindow > 0
			? Math.floor(model.effectiveContextWindow)
			: contextWindow;
	return contextWindow > 0 ? Math.min(contextWindow, effectiveContextWindow) : effectiveContextWindow;
}

export function applyCodexInteractionMetadata<TApi extends Api>(
	model: Model<TApi>,
	providerContextWindow?: number,
): Model<TApi> {
	if (model.provider !== "openai-codex" && model.provider !== "litellm") return model;
	const interaction = CODEX_MODEL_INTERACTION_METADATA[model.id];
	if (!interaction) return model;
	const rawProviderLimit =
		providerContextWindow ??
		model.providerContextWindow ??
		(model.provider === "openai-codex" ? interaction.maxContextWindow : model.contextWindow);
	const advertisedLimit = Math.min(rawProviderLimit, interaction.internalProviderMaxContextWindow);
	const budget = resolveCodexContextBudget(model.id, "standard", advertisedLimit)!;
	return {
		...model,
		thinking: interaction.thinking,
		contextWindow: budget.contextWindow,
		maxContextWindow: interaction.maxContextWindow,
		maxTokens: interaction.outputLimit,
		providerContextWindow: advertisedLimit,
		effectiveContextWindowPercent: interaction.effectiveContextWindowPercent,
		autoCompactThresholdPercent: interaction.autoCompactThresholdPercent,
		effectiveContextWindow: budget.effectiveContextWindow,
		autoCompactTokenLimit: budget.autoCompactTokenLimit,
		defaultReasoningSummary: interaction.defaultReasoningSummary,
		defaultVerbosity: interaction.defaultVerbosity,
		serviceTiers: interaction.serviceTiers,
		defaultServiceTier: interaction.defaultServiceTier,
		truncationPolicy: interaction.truncationPolicy,
		supportsParallelToolCalls: interaction.supportsParallelToolCalls,
	};
}
