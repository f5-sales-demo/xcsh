/**
 * Classify an install spec as a marketplace plugin reference or a plain npm package.
 *
 * Rules (applied in order):
 *  0. `npm:<pkg>` prefix -> always npm (explicit escape hatch; the prefix is stripped).
 *  1. Starts with `@` (scoped npm) -> always npm.
 *  2. Contains `@` after the first character -> split on the LAST `@`.
 *     If the right-hand side is a known marketplace name, it's a marketplace ref.
 *     Otherwise it's an npm spec (e.g. `pkg@1.2.3`).
 *  3. Bare name (no `@`) -> look it up against the marketplace catalog index:
 *       - exactly one marketplace publishes it -> marketplace ref;
 *       - more than one -> ambiguous (caller errors and asks for `name@marketplace`);
 *       - none (or no index supplied) -> npm.
 *     This is what makes `xcsh plugin install azure` resolve to the marketplace
 *     `azure` plugin rather than the public npm package of the same name.
 */
// Common npm dist-tags that should never be interpreted as marketplace names
const NPM_DIST_TAGS = new Set([
	"latest",
	"next",
	"beta",
	"alpha",
	"canary",
	"rc",
	"dev",
	"stable",
	"nightly",
	"experimental",
]);

// Semver-like: starts with digit, or contains version range prefixes
const LOOKS_LIKE_VERSION = /^[\d~^>=<]/;

export type InstallTarget =
	| { type: "marketplace"; name: string; marketplace: string }
	| { type: "ambiguous"; name: string; marketplaces: string[] }
	| { type: "npm"; spec: string };

export function classifyInstallTarget(
	spec: string,
	knownMarketplaces: Set<string>,
	/** plugin name -> marketplaces whose catalog publishes a plugin with that name */
	catalogIndex?: Map<string, string[]>,
): InstallTarget {
	// Rule 0: explicit npm escape hatch — force npm even if a marketplace shares the name.
	if (spec.startsWith("npm:")) return { type: "npm", spec: spec.slice("npm:".length) };
	// Rule 1: scoped npm package — @ at position 0 is never a marketplace separator.
	if (spec.startsWith("@")) return { type: "npm", spec };
	// Rule 2: @ somewhere after the first character.
	const atIdx = spec.lastIndexOf("@");
	if (atIdx > 0) {
		const rhs = spec.slice(atIdx + 1);
		// Dist-tags and version specifiers are never marketplace names.
		if (NPM_DIST_TAGS.has(rhs) || LOOKS_LIKE_VERSION.test(rhs)) {
			return { type: "npm", spec };
		}
		if (knownMarketplaces.has(rhs)) {
			return { type: "marketplace", name: spec.slice(0, atIdx), marketplace: rhs };
		}
		// Not a known marketplace — treat as npm version specifier.
		return { type: "npm", spec };
	}
	// Rule 3: bare name — resolve against the marketplace catalog index before npm.
	const sources = catalogIndex?.get(spec);
	if (sources && sources.length === 1) {
		return { type: "marketplace", name: spec, marketplace: sources[0] };
	}
	if (sources && sources.length > 1) {
		return { type: "ambiguous", name: spec, marketplaces: sources };
	}
	// Rule 4: no marketplace publishes this name — plain npm package.
	return { type: "npm", spec };
}
