import { describe, expect, it } from "bun:test";
import type { RuntimeBuildInfo } from "../../src/internal-urls/build-info-runtime";
import { CAPABILITY_MAP, createSourceResolver, renderSourceDoc } from "../../src/internal-urls/source-resolve";
import type { InternalUrl } from "../../src/internal-urls/types";

function parseUrl(urlStr: string): InternalUrl {
	const url = new URL(urlStr) as InternalUrl;
	const match = urlStr.match(/^xcsh:\/\/([^/?#]+)(\/[^?#]*)?/);
	url.rawHost = match?.[1] ?? "";
	url.rawPathname = match?.[2] ?? "/";
	return url;
}

function fakeInfo(overrides: Partial<RuntimeBuildInfo> = {}): RuntimeBuildInfo {
	return {
		version: "19.85.7",
		commit: "9ca40d6aa",
		shortCommit: "9ca40d6",
		branch: "main",
		tag: "v19.85.7",
		commitDate: "2026-07-20T12:00:00Z",
		buildDate: "2026-07-20T12:05:00Z",
		dirty: false,
		prNumber: "2304",
		repoUrl: "https://github.com/f5-sales-demo/xcsh",
		repoSlug: "f5-sales-demo/xcsh",
		commitUrl: "https://github.com/f5-sales-demo/xcsh/commit/9ca40d6aa",
		releaseUrl: "https://github.com/f5-sales-demo/xcsh/releases/tag/v19.85.7",
		source: "compiled",
		resolvedAt: "2026-07-24T00:00:00Z",
		...overrides,
	};
}

describe("xcsh://source resolver", () => {
	it("maps core capabilities to concrete source paths", async () => {
		const resolver = createSourceResolver({ resolveBuildInfo: async () => fakeInfo() });
		const result = await resolver.resolve(parseUrl("xcsh://source"));
		expect(result.contentType).toBe("text/markdown");
		// system prompt
		expect(result.content).toContain("packages/coding-agent/src/prompts/system/system-prompt.md");
		// the xcsh:// resolver layer itself
		expect(result.content).toContain("packages/coding-agent/src/internal-urls/");
		// the release chain
		expect(result.content).toContain("scripts/release.ts");
	});

	it("states the soft-vs-hard editable-surface rule and the repo URL", async () => {
		const resolver = createSourceResolver({ resolveBuildInfo: async () => fakeInfo() });
		const result = await resolver.resolve(parseUrl("xcsh://source"));
		expect(result.content.toLowerCase()).toContain("soft");
		expect(result.content.toLowerCase()).toContain("hard");
		expect(result.content).toContain("https://github.com/f5-sales-demo/xcsh");
	});

	it("every capability entry has a non-empty capability, path, and note", () => {
		expect(CAPABILITY_MAP.length).toBeGreaterThan(3);
		for (const entry of CAPABILITY_MAP) {
			expect(entry.capability.length).toBeGreaterThan(0);
			expect(entry.path.length).toBeGreaterThan(0);
			expect(entry.note.length).toBeGreaterThan(0);
		}
	});

	it("renderSourceDoc links paths to the running commit on GitHub", () => {
		const doc = renderSourceDoc(fakeInfo());
		// a source path should be browsable at the exact commit, not a guessed branch
		expect(doc).toContain("/blob/9ca40d6aa/");
	});
});
