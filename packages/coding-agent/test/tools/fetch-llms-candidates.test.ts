import { describe, expect, it } from "bun:test";
import { buildLlmEndpointCandidates } from "../../src/web/llms-endpoints";

// The federated product docs publish an llms.txt index per language
// (`<locale>/llms.txt`) as well as one at the repo root. Reaching the
// language-specific one depends entirely on this scope walk running from the
// deepest path scope outwards, so the ordering is a contract, not an accident:
// shallowest-first, or capping the walk at the repo segment, would silently send
// every non-English request back to English context.
describe("buildLlmEndpointCandidates", () => {
	const origin = "https://f5-sales-demo.github.io";

	it("offers the well-known location first for an origin root", () => {
		expect(buildLlmEndpointCandidates(`${origin}/`)).toEqual([
			`${origin}/.well-known/llms.txt`,
			`${origin}/llms.txt`,
			`${origin}/llms.md`,
		]);
	});

	it("offers a locale index before the repo-root index for a locale-scoped page", () => {
		const candidates = buildLlmEndpointCandidates(`${origin}/mcn/ja/demo/`);
		expect(candidates).toEqual([
			`${origin}/mcn/ja/demo/llms.txt`,
			`${origin}/mcn/ja/demo/llms.md`,
			`${origin}/mcn/ja/llms.txt`,
			`${origin}/mcn/ja/llms.md`,
			`${origin}/mcn/llms.txt`,
			`${origin}/mcn/llms.md`,
		]);
	});

	it("reaches the locale index from a page URL with no trailing slash", () => {
		const candidates = buildLlmEndpointCandidates(`${origin}/mcn/ja/demo/verify`);
		expect(candidates.indexOf(`${origin}/mcn/ja/llms.txt`)).toBeGreaterThanOrEqual(0);
		expect(candidates.indexOf(`${origin}/mcn/ja/llms.txt`)).toBeLessThan(
			candidates.indexOf(`${origin}/mcn/llms.txt`),
		);
	});

	it("keeps a hyphenated locale segment intact", () => {
		expect(buildLlmEndpointCandidates(`${origin}/mcn/pt-br/demo/`)).toContain(`${origin}/mcn/pt-br/llms.txt`);
	});

	it("stops at the first path segment rather than probing the origin root", () => {
		const candidates = buildLlmEndpointCandidates(`${origin}/mcn/`);
		expect(candidates).toEqual([`${origin}/mcn/llms.txt`, `${origin}/mcn/llms.md`]);
	});

	it("prioritizes French locale index before root index for localized portal pages", () => {
		const candidates = buildLlmEndpointCandidates(`${origin}/docs/fr/waf/overview/`);
		expect(candidates[0]).toBe(`${origin}/docs/fr/waf/overview/llms.txt`);
		expect(candidates).toContain(`${origin}/docs/fr/llms.txt`);
		expect(candidates.indexOf(`${origin}/docs/fr/llms.txt`)).toBeLessThan(
			candidates.indexOf(`${origin}/docs/llms.txt`),
		);
	});

	it("returns deduplicated unique candidates for redundant paths", () => {
		const candidates = buildLlmEndpointCandidates(`${origin}/docs/llms.txt`);
		const unique = new Set(candidates);
		expect(candidates.length).toBe(unique.size);
	});

	it("returns nothing for an unparseable URL", () => {
		expect(buildLlmEndpointCandidates("not a url")).toEqual([]);
	});
});
