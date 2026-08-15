export type SubscriptionProfileId = "google-antigravity";

export interface SubscriptionRoutingProfile {
	id: SubscriptionProfileId;
	provider: string;
	roles: Readonly<Record<"smol" | "default" | "slow" | "plan", string>>;
}

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
