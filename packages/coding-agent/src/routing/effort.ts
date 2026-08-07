import type { RoutingTier } from "./types";

const DEFAULT_EFFORT_MAP: Record<RoutingTier, string> = {
	utility: "low",
	balanced: "medium",
	frontier: "high",
};

export function mapTierToEffort(tier: RoutingTier, customMap?: Record<string, string>): string {
	if (customMap?.[tier]) {
		return customMap[tier];
	}
	return DEFAULT_EFFORT_MAP[tier] ?? "medium";
}
