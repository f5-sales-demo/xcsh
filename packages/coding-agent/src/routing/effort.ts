import type { RoutingEffort, RoutingEffortPolicy, RoutingEffortReason, RoutingTier } from "./types";

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

export function resolveRoutingEffort(
	tier: RoutingTier,
	complexityScore: number,
	priorRejection: boolean,
	policy?: RoutingEffortPolicy,
	customMap?: Record<string, string>,
): { effort: RoutingEffort; reason: RoutingEffortReason } {
	const defaultEffort = (customMap?.[tier] ?? policy?.byTier[tier] ?? mapTierToEffort(tier)) as RoutingEffort;
	const escalation = policy?.frontierEscalation;
	if (tier === "frontier" && escalation) {
		if (priorRejection) return { effort: escalation.effort, reason: "rejection_escalation" };
		if (complexityScore >= escalation.minimumComplexityScore) {
			return { effort: escalation.effort, reason: "complexity_escalation" };
		}
	}
	return { effort: defaultEffort, reason: "tier_default" };
}
