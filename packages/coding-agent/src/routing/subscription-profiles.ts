import type { RoutingPoolConfig } from "./types";

export type SubscriptionProfileId = "google-antigravity" | "openai-codex";

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

export const SUBSCRIPTION_ROUTING_PROFILES: Readonly<Record<SubscriptionProfileId, SubscriptionRoutingProfile>> = {
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
	const missingModels = [
		...new Set(
			Object.values(profile.roles)
				.map(modelSelector)
				.filter(model => !available.has(model)),
		),
	];
	if (missingModels.length > 0) {
		return { applied: false, roles: { ...currentRoles }, missingModels };
	}
	return { applied: true, roles: { ...currentRoles, ...profile.roles }, missingModels: [] };
}

export const OPENAI_CODEX_ROUTING_POOL = OPENAI_CODEX_POOL;
