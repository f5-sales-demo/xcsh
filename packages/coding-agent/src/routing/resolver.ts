import type { RoutingPoolConfig, RoutingTier } from "./types";

export interface ResolveTierResult {
	selectedModel?: string;
	effectiveTier?: RoutingTier;
	degraded: boolean;
	availableTiersCount: number;
}

const TIER_ORDER: RoutingTier[] = ["utility", "balanced", "frontier"];

/**
 * Resolve the best candidate model for a desired tier within a pool based on available models.
 * If desired tier is unavailable, searches higher tiers (utility -> balanced -> frontier).
 * If fewer than 2 total tiers in pool are available, pool is degraded and passes through.
 */
export function resolveTierModel(
	pool: RoutingPoolConfig | undefined,
	desiredTier: RoutingTier,
	availableModels: string[],
): ResolveTierResult {
	if (!pool) {
		return { degraded: false, availableTiersCount: 0 };
	}

	const isAvailable = (selector: string): boolean => {
		if (availableModels.includes(selector)) return true;
		if (pool.provider) {
			const qualified = `${pool.provider}/${selector}`;
			if (availableModels.includes(qualified)) return true;
		}
		// Also check if selector is prefixed
		return availableModels.some(m => m === selector || m.endsWith(`/${selector}`));
	};

	const utilityAvailable = isAvailable(pool.tiers.utility);
	const balancedAvailable = isAvailable(pool.tiers.balanced);
	const frontierAvailable = isAvailable(pool.tiers.frontier);

	const availableTiers: Record<RoutingTier, boolean> = {
		utility: utilityAvailable,
		balanced: balancedAvailable,
		frontier: frontierAvailable,
	};

	const availableCount = [utilityAvailable, balancedAvailable, frontierAvailable].filter(Boolean).length;

	if (availableCount < 2) {
		return { degraded: true, availableTiersCount: availableCount };
	}

	const desiredIndex = TIER_ORDER.indexOf(desiredTier);

	// Search desired tier, then higher tiers
	for (let i = desiredIndex; i < TIER_ORDER.length; i++) {
		const tier = TIER_ORDER[i];
		if (availableTiers[tier]) {
			return {
				selectedModel: pool.tiers[tier],
				effectiveTier: tier,
				degraded: false,
				availableTiersCount: availableCount,
			};
		}
	}

	// Fallback to highest available tier if no higher tier found (should not happen if count >= 2)
	for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
		const tier = TIER_ORDER[i];
		if (availableTiers[tier]) {
			return {
				selectedModel: pool.tiers[tier],
				effectiveTier: tier,
				degraded: false,
				availableTiersCount: availableCount,
			};
		}
	}

	return { degraded: true, availableTiersCount: 0 };
}
