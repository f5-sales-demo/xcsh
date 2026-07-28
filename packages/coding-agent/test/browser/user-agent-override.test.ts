import { describe, expect, test } from "bun:test";
import { deriveUserAgentOverride } from "../../src/tools/browser-user-agent";

// These assertions exist because the stealth user-agent metadata is DERIVED from
// whichever Chrome puppeteer bundles, so a puppeteer bump silently changes the
// output. Bumping 24.43.1 -> 25.3.0 moved bundled Chrome 148 -> 150, and the
// GREASE permutation is seeded by the major version: 148 % 6 = 4 but 150 % 6 = 0.
// That reorders the brand list and rewrites the greased brand string.
//
// Ground truth for the algorithm is Chromium's GenerateBrandVersionList
// (components/embedder_support/user_agent_utils.cc): a 6-entry permutation table
// indexed by `major % 6`, with the greased brand assembled from the escape
// characters [" ", " ", ";"] in permuted order.
//
// Deliberately a pure unit test with no browser launch, so it runs in CI on
// every PR. The companion live-Chrome assertions (that the override actually
// reaches the page) are in test/e2e/extension-e2e.test.ts, which is
// describe.skipIf(isCI) and therefore local-only.

const MAC_UA_150 =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const MAC_HEADLESS_UA_150 =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/150.0.0.0 Safari/537.36";
const MAC_UA_148 =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

/** Chrome's greased brand for a given permutation, per Chromium's escape-char table. */
const GREASE_CHARS = [" ", " ", ";"] as const;
function greasedBrand(order: readonly number[]): string {
	return `${GREASE_CHARS[order[0]]}Not${GREASE_CHARS[order[1]]}A${GREASE_CHARS[order[2]]}Brand`;
}

describe("deriveUserAgentOverride — brand list GREASE permutation", () => {
	test("Chrome 150 uses permutation 0, putting the greased brand first", () => {
		const override = deriveUserAgentOverride(MAC_UA_150, "Chrome/150.0.7871.24");
		// 150 % 6 === 0 -> order [0, 1, 2]
		expect(override.userAgentMetadata.brands).toEqual([
			{ brand: " Not A;Brand", version: "99" },
			{ brand: "Chromium", version: "150" },
			{ brand: "Google Chrome", version: "150" },
		]);
	});

	test("Chrome 148 uses permutation 4, putting the greased brand last with different escapes", () => {
		const override = deriveUserAgentOverride(MAC_UA_148, "Chrome/148.0.7780.0");
		// 148 % 6 === 4 -> order [2, 0, 1]
		expect(override.userAgentMetadata.brands).toEqual([
			{ brand: "Chromium", version: "148" },
			{ brand: "Google Chrome", version: "148" },
			{ brand: ";Not A Brand", version: "99" },
		]);
	});

	test("the 148 -> 150 bump genuinely changes the emitted brand list", () => {
		const before = deriveUserAgentOverride(MAC_UA_148, "Chrome/148.0.7780.0").userAgentMetadata.brands;
		const after = deriveUserAgentOverride(MAC_UA_150, "Chrome/150.0.7871.24").userAgentMetadata.brands;
		expect(after).not.toEqual(before);
		// Not merely renumbered: the greased brand moved position AND changed spelling.
		expect(before[2]?.brand).toBe(";Not A Brand");
		expect(after[0]?.brand).toBe(" Not A;Brand");
	});

	test("every major-version residue yields a dense, complete, correctly-greased brand list", () => {
		const permutations = [
			[0, 1, 2],
			[0, 2, 1],
			[1, 0, 2],
			[1, 2, 0],
			[2, 0, 1],
			[2, 1, 0],
		];
		for (let major = 100; major < 100 + 24; major++) {
			const ua = MAC_UA_150.replace("Chrome/150", `Chrome/${major}`);
			const brands = deriveUserAgentOverride(ua, `Chrome/${major}.0.0.0`).userAgentMetadata.brands;
			const order = permutations[major % 6];

			// A sparse assignment (brands[order[n]] = …) would leave holes; reject those.
			expect(brands).toHaveLength(3);
			for (const entry of brands) {
				expect(entry).toBeDefined();
				expect(typeof entry.brand).toBe("string");
			}

			expect(brands[order[0]]).toEqual({ brand: greasedBrand(order), version: "99" });
			expect(brands[order[1]]).toEqual({ brand: "Chromium", version: String(major) });
			expect(brands[order[2]]).toEqual({ brand: "Google Chrome", version: String(major) });
		}
	});
});

describe("deriveUserAgentOverride — user agent string laundering", () => {
	test("rewrites HeadlessChrome, the single strongest automation tell", () => {
		const override = deriveUserAgentOverride(MAC_HEADLESS_UA_150, "Chrome/150.0.7871.24");
		expect(override.userAgent).not.toInclude("HeadlessChrome");
		expect(override.userAgent).toInclude("Chrome/150.0.0.0");
	});

	test("presents Linux as Windows, since a Linux desktop Chrome is itself unusual", () => {
		const linuxUA =
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/150.0.0.0 Safari/537.36";
		const override = deriveUserAgentOverride(linuxUA, "Chrome/150.0.7871.24");
		expect(override.userAgent).toInclude("(Windows NT 10.0; Win64; x64)");
		expect(override.userAgent).not.toInclude("Linux");
		expect(override.platform).toBe("Win32");
		expect(override.userAgentMetadata.platform).toBe("Windows");
		expect(override.userAgentMetadata.platformVersion).toBe("10.0");
	});

	test("leaves Android alone, because there Linux is the truthful platform", () => {
		const androidUA =
			"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36";
		const override = deriveUserAgentOverride(androidUA, "Chrome/150.0.7871.24");
		expect(override.userAgent).toInclude("Android 13");
		expect(override.platform).toBe("Android");
		expect(override.userAgentMetadata.mobile).toBe(true);
		expect(override.userAgentMetadata.platformVersion).toBe("13");
		expect(override.userAgentMetadata.model).toBe("Pixel 7");
		expect(override.userAgentMetadata.architecture).toBe("");
	});
});

describe("deriveUserAgentOverride — platform metadata must agree with the UA string", () => {
	test("macOS maps to MacIntel with an underscore-form platform version", () => {
		const override = deriveUserAgentOverride(MAC_UA_150, "Chrome/150.0.7871.24");
		expect(override.platform).toBe("MacIntel");
		expect(override.userAgentMetadata.platform).toBe("Mac OS X");
		expect(override.userAgentMetadata.platformVersion).toBe("10_15_7");
		expect(override.userAgentMetadata.mobile).toBe(false);
		expect(override.userAgentMetadata.architecture).toBe("x86");
		expect(override.userAgentMetadata.model).toBe("");
	});

	test("fullVersion tracks the UA's Chrome token, not the browser build string", () => {
		const override = deriveUserAgentOverride(MAC_UA_150, "Chrome/150.0.7871.24");
		expect(override.userAgentMetadata.fullVersion).toBe("150.0.0.0");
	});

	test("falls back to the browser version when the UA carries no Chrome token", () => {
		const noChromeUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)";
		const override = deriveUserAgentOverride(noChromeUA, "Chrome/150.0.7871.24");
		expect(override.userAgentMetadata.fullVersion).toBe("150.0.7871.24");
		expect(override.userAgentMetadata.brands).toEqual([
			{ brand: " Not A;Brand", version: "99" },
			{ brand: "Chromium", version: "150" },
			{ brand: "Google Chrome", version: "150" },
		]);
	});

	test("pins the accept-language the stealth profile claims", () => {
		expect(deriveUserAgentOverride(MAC_UA_150, "Chrome/150.0.7871.24").acceptLanguage).toBe("en-US,en");
	});
});
