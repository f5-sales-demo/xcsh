import type { MarketplaceRefreshResult } from "./manager";

export function formatMarketplaceRefreshWarning(result: MarketplaceRefreshResult): string | undefined {
	if (result.failed.length === 0) return undefined;
	const noun = result.failed.length === 1 ? "marketplace" : "marketplaces";
	return `Warning: Could not refresh ${noun}: ${result.failed.join(", ")}. Showing last-known catalog data where available (offline/stale).`;
}
