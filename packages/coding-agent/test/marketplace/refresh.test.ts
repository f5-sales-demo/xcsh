import { describe, expect, it } from "bun:test";
import { formatMarketplaceRefreshWarning } from "../../src/extensibility/plugins/marketplace";

describe("formatMarketplaceRefreshWarning", () => {
	it("returns no warning when every marketplace refreshed", () => {
		expect(formatMarketplaceRefreshWarning({ successful: ["healthy"], failed: [] })).toBeUndefined();
	});

	it("names failed marketplaces and explains the offline fallback", () => {
		expect(formatMarketplaceRefreshWarning({ successful: ["healthy"], failed: ["offline", "broken"] })).toBe(
			"Warning: Could not refresh marketplaces: offline, broken. Showing last-known catalog data where available (offline/stale).",
		);
	});
});
