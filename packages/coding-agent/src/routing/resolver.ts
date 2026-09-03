import { checkCandidateContextEligible } from "./context-filter";
import type { RoutingPoolConfig, RoutingTier } from "./types";

export interface ResolveTierResult {
	selectedModel?: string;
	effectiveTier?: RoutingTier;
	degraded: boolean;
	availableTiersCount: number;
}

export interface ResolveTierOptions {
	contextEstimate?: { usedTokens: number; contextWindow: number; reserveTokens?: number };
	getModelContextWindow?: (modelId: string) => number;
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
	options?: ResolveTierOptions,
): ResolveTierResult {
	if (!pool) {
		return { degraded: false, availableTiersCount: 0 };
	}

	const resolveAvailableSelector = (selector: string): string | undefined => {
		if (pool.provider) {
			const qualified = selector.includes("/") ? selector : `${pool.provider}/${selector}`;
			const resolved =
				availableModels.find(model => model === qualified || model === selector) ??
				(pool.provider === "anthropic" && selector === "claude-haiku-4-5"
					? availableModels.find(model => /^anthropic\/claude-haiku-4-5-\d{8}$/.test(model))
					: undefined);
			if (!resolved) return undefined;

			if (options?.contextEstimate && options?.getModelContextWindow) {
				const candidateWin = options.getModelContextWindow(resolved) || options.getModelContextWindow(selector);
				if (
					candidateWin > 0 &&
					!checkCandidateContextEligible({
						estimatedInputTokens: options.contextEstimate.usedTokens,
						candidateContextWindow: candidateWin,
						reserveTokens: options.contextEstimate.reserveTokens,
					})
				) {
					return undefined;
				}
			}
			return resolved.includes("/") ? resolved : qualified;
		}

		const resolved = availableModels.find(
			model => model === selector || (model.includes("/") && model.split("/")[1] === selector),
		);
		if (!resolved) return undefined;

		if (options?.contextEstimate && options?.getModelContextWindow) {
			const candidateWin = options.getModelContextWindow(selector);
			if (
				candidateWin > 0 &&
				!checkCandidateContextEligible({
					estimatedInputTokens: options.contextEstimate.usedTokens,
					candidateContextWindow: candidateWin,
					reserveTokens: options.contextEstimate.reserveTokens,
				})
			) {
				return undefined;
			}
		}

		return resolved;
	};

	const resolvedModels: Record<RoutingTier, string | undefined> = {
		utility: resolveAvailableSelector(pool.tiers.utility),
		balanced: resolveAvailableSelector(pool.tiers.balanced),
		frontier: resolveAvailableSelector(pool.tiers.frontier),
	};

	const availableTiers: Record<RoutingTier, boolean> = {
		utility: resolvedModels.utility !== undefined,
		balanced: resolvedModels.balanced !== undefined,
		frontier: resolvedModels.frontier !== undefined,
	};

	const availableCount = Object.values(availableTiers).filter(Boolean).length;

	if (availableCount < 2) {
		return { degraded: true, availableTiersCount: availableCount };
	}

	const desiredIndex = TIER_ORDER.indexOf(desiredTier);

	// Search desired tier, then higher tiers
	for (let i = desiredIndex; i < TIER_ORDER.length; i++) {
		const tier = TIER_ORDER[i];
		if (availableTiers[tier]) {
			return {
				selectedModel: resolvedModels[tier],
				effectiveTier: tier,
				degraded: false,
				availableTiersCount: availableCount,
			};
		}
	}

	return { degraded: true, availableTiersCount: 0 };
}
