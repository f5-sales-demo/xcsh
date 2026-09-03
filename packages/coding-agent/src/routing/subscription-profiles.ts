import type { RoutingPoolConfig } from "./types";

export type SubscriptionProfileId = "anthropic" | "google-antigravity" | "openai-codex";

export interface SubscriptionRoutingProfile {
	id: SubscriptionProfileId;
	provider: string;
	roles: Readonly<Record<"smol" | "default" | "slow" | "plan", string>>;
	pool?: RoutingPoolConfig;
}

const OPENAI_CODEX_POOL: RoutingPoolConfig = {
	id: "openai-codex/gpt-5.6",
	provider: "openai-codex",
	tiers: {
		utility: "gpt-5.6-luna",
		balanced: "gpt-5.6-terra",
		frontier: "gpt-5.6-sol",
	},
	effortPolicy: {
		byTier: { utility: "low", balanced: "medium", frontier: "high" },
		frontierEscalation: { effort: "xhigh", minimumComplexityScore: 90 },
	},
};

const ANTHROPIC_POOL: RoutingPoolConfig = {
	id: "anthropic/claude",
	provider: "anthropic",
	tiers: {
		utility: "claude-haiku-4-5",
		balanced: "claude-sonnet-5",
		frontier: "claude-opus-5",
	},
	effortPolicy: {
		byTier: { utility: "low", balanced: "medium", frontier: "high" },
		frontierEscalation: { effort: "xhigh", minimumComplexityScore: 90 },
	},
};

export const SUBSCRIPTION_ROUTING_PROFILES: Readonly<Record<SubscriptionProfileId, SubscriptionRoutingProfile>> = {
	anthropic: {
		id: "anthropic",
		provider: "anthropic",
		roles: {
			smol: "anthropic/claude-haiku-4-5:low",
			default: "anthropic/claude-sonnet-5:medium",
			slow: "anthropic/claude-opus-5:high",
			plan: "anthropic/claude-opus-5:high",
		},
		pool: ANTHROPIC_POOL,
	},
	"google-antigravity": {
		id: "google-antigravity",
		provider: "google-antigravity",
		roles: {
			smol: "google-antigravity/gemini-3.6-flash-high:high",
			default: "google-antigravity/gemini-3.6-flash-high:high",
			slow: "google-antigravity/gemini-3.1-pro-high-vertex:high",
			plan: "google-antigravity/gemini-3.1-pro-high-vertex:high",
		},
	},
	"openai-codex": {
		id: "openai-codex",
		provider: "openai-codex",
		roles: {
			smol: "openai-codex/gpt-5.6-luna:low",
			default: "openai-codex/gpt-5.6-terra:medium",
			slow: "openai-codex/gpt-5.6-sol:high",
			plan: "openai-codex/gpt-5.6-sol:high",
		},
		pool: OPENAI_CODEX_POOL,
	},
};

function modelSelector(roleSelector: string): string {
	const colon = roleSelector.lastIndexOf(":");
	return colon > roleSelector.indexOf("/") ? roleSelector.slice(0, colon) : roleSelector;
}

export interface ApplySubscriptionProfileResult {
	applied: boolean;
	roles: Record<string, string>;
	missingModels: string[];
}

/** Resolve a complete profile before mutating settings so partial entitlement can never partially apply. */
export function applySubscriptionProfileRoles(
	profileId: SubscriptionProfileId,
	currentRoles: Readonly<Record<string, string>>,
	availableModels: readonly string[],
): ApplySubscriptionProfileResult {
	const profile = SUBSCRIPTION_ROUTING_PROFILES[profileId];
	const available = new Set(availableModels);
	const roles = profileId === "anthropic" ? resolveAnthropicRoles(availableModels, profile.roles) : profile.roles;
	const missingModels = [
		...new Set(
			Object.values(roles)
				.map(modelSelector)
				.filter(model => !available.has(model)),
		),
	];
	if (missingModels.length > 0) {
		return { applied: false, roles: { ...currentRoles }, missingModels };
	}
	return { applied: true, roles: { ...currentRoles, ...roles }, missingModels: [] };
}

function resolveAnthropicRoles(
	availableModels: readonly string[],
	fallback: Readonly<Record<"smol" | "default" | "slow" | "plan", string>>,
): Readonly<Record<"smol" | "default" | "slow" | "plan", string>> {
	const haiku =
		availableModels.find(selector => selector === "anthropic/claude-haiku-4-5") ??
		availableModels.find(selector => /^anthropic\/claude-haiku-4-5-\d{8}$/.test(selector));
	if (!haiku) return fallback;
	return { ...fallback, smol: `${haiku}:low` };
}

export const OPENAI_CODEX_ROUTING_POOL = OPENAI_CODEX_POOL;
export const ANTHROPIC_ROUTING_POOL = ANTHROPIC_POOL;
