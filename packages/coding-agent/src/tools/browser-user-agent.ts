/**
 * Derives the stealth user-agent override from whichever Chrome puppeteer bundles.
 *
 * Split out of `browser.ts` so it can be asserted without launching a browser:
 * every field here is a pure function of the raw user-agent string and the
 * browser version, and the output changes whenever puppeteer's bundled Chrome
 * changes major version. See `test/browser/user-agent-override.test.ts`.
 */

const STEALTH_ACCEPT_LANGUAGE = "en-US,en";

export type UserAgentOverride = {
	userAgent: string;
	platform: string;
	acceptLanguage: string;
	userAgentMetadata: {
		brands: Array<{ brand: string; version: string }>;
		fullVersion: string;
		platform: string;
		platformVersion: string;
		architecture: string;
		model: string;
		mobile: boolean;
	};
};

/**
 * Chromium's GREASE permutation table, indexed by `majorVersion % 6`.
 * Mirrors `GenerateBrandVersionList` in
 * components/embedder_support/user_agent_utils.cc — Chrome shuffles the brand
 * list per version so that servers cannot hardcode its ordering, and a client
 * that emits a fixed order is detectable for that reason alone.
 */
const BRAND_ORDERS: ReadonlyArray<readonly [number, number, number]> = [
	[0, 1, 2],
	[0, 2, 1],
	[1, 0, 2],
	[1, 2, 0],
	[2, 0, 1],
	[2, 1, 0],
];

/** The escape characters Chromium permutes into the greased brand name. */
const GREASE_ESCAPE_CHARS = [" ", " ", ";"] as const;

/** Builds the three-entry brand list for a Chrome major version. */
function buildBrands(majorVersion: number): Array<{ brand: string; version: string }> {
	const order = BRAND_ORDERS[majorVersion % BRAND_ORDERS.length] ?? BRAND_ORDERS[0];
	const greasedBrand = `${GREASE_ESCAPE_CHARS[order[0]]}Not${GREASE_ESCAPE_CHARS[order[1]]}A${GREASE_ESCAPE_CHARS[order[2]]}Brand`;
	const brands: Array<{ brand: string; version: string }> = [];
	brands[order[0]] = { brand: greasedBrand, version: "99" };
	brands[order[1]] = { brand: "Chromium", version: String(majorVersion) };
	brands[order[2]] = { brand: "Google Chrome", version: String(majorVersion) };
	return brands;
}

/**
 * @param rawUserAgent the browser's own user-agent string, e.g. from `browser.userAgent()`
 * @param browserVersion the browser version string, e.g. from `browser.version()`;
 *   used only when the user agent carries no `Chrome/<version>` token
 */
export function deriveUserAgentOverride(rawUserAgent: string, browserVersion: string): UserAgentOverride {
	let userAgent = rawUserAgent.replace("HeadlessChrome/", "Chrome/");
	if (userAgent.includes("Linux") && !userAgent.includes("Android")) {
		userAgent = userAgent.replace(/\(([^)]+)\)/, "(Windows NT 10.0; Win64; x64)");
	}

	const uaVersionMatch = userAgent.match(/Chrome\/([\d|.]+)/);
	const fallbackVersionMatch = uaVersionMatch ?? browserVersion.match(/\/([\d|.]+)/);
	const uaVersion = fallbackVersionMatch?.[1] ?? "0";
	const majorVersion = Number.parseInt(uaVersion.split(".")[0] ?? "0", 10) || 0;
	const isAndroid = userAgent.includes("Android");
	const platform = userAgent.includes("Mac OS X")
		? "MacIntel"
		: isAndroid
			? "Android"
			: userAgent.includes("Linux")
				? "Linux"
				: "Win32";
	const platformFull = userAgent.includes("Mac OS X")
		? "Mac OS X"
		: isAndroid
			? "Android"
			: userAgent.includes("Linux")
				? "Linux"
				: "Windows";
	const platformVersion = userAgent.includes("Mac OS X ")
		? (userAgent.match(/Mac OS X ([^)]+)/)?.[1] ?? "")
		: userAgent.includes("Android ")
			? (userAgent.match(/Android ([^;]+)/)?.[1] ?? "")
			: userAgent.includes("Windows ")
				? (userAgent.match(/Windows .*?([\d|.]+);?/)?.[1] ?? "")
				: "";
	const architecture = isAndroid ? "" : "x86";
	const model = isAndroid ? (userAgent.match(/Android.*?;\s([^)]+)/)?.[1] ?? "") : "";

	return {
		userAgent,
		platform,
		acceptLanguage: STEALTH_ACCEPT_LANGUAGE,
		userAgentMetadata: {
			brands: buildBrands(majorVersion),
			fullVersion: uaVersion,
			platform: platformFull,
			platformVersion,
			architecture,
			model,
			mobile: isAndroid,
		},
	};
}
