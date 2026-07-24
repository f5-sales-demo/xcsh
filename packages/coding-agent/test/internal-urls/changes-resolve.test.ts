import { describe, expect, it } from "bun:test";
import type { RuntimeBuildInfo } from "../../src/internal-urls/build-info-runtime";
import { createChangesResolver, type GhResult, parseMergedPrs } from "../../src/internal-urls/changes-resolve";
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
		commit: "9ca40d6aa0000000000000000000000000000000",
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

const SAMPLE_PRS = JSON.stringify([
	{
		number: 2310,
		title: "feat: add xcsh://changes route",
		mergedAt: "2026-07-23T09:00:00Z",
		url: "https://github.com/f5-sales-demo/xcsh/pull/2310",
	},
	{
		number: 2300,
		title: "fix: old thing merged before this build",
		mergedAt: "2026-07-19T09:00:00Z",
		url: "https://github.com/f5-sales-demo/xcsh/pull/2300",
	},
]);

function ghOk(stdout: string): (args: string[]) => Promise<GhResult> {
	return async () => ({ ok: true, stdout, stderr: "" });
}

describe("xcsh://changes resolver", () => {
	it("renders recent merged PRs parsed from gh JSON", async () => {
		const resolver = createChangesResolver({
			resolveBuildInfo: async () => fakeInfo(),
			runGh: ghOk(SAMPLE_PRS),
			now: () => new Date("2026-07-24T00:00:00Z"),
		});
		const result = await resolver.resolve(parseUrl("xcsh://changes"));
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain("#2310");
		expect(result.content).toContain("feat: add xcsh://changes route");
		expect(result.content).toContain("https://github.com/f5-sales-demo/xcsh/pull/2310");
		// running build fingerprint is surfaced so the reader can reason about "new to me"
		expect(result.content).toContain("19.85.7");
	});

	it("flags PRs merged after the running build's commit date as new", async () => {
		const resolver = createChangesResolver({
			resolveBuildInfo: async () => fakeInfo({ commitDate: "2026-07-20T12:00:00Z" }),
			runGh: ghOk(SAMPLE_PRS),
			now: () => new Date("2026-07-24T00:00:00Z"),
		});
		const result = await resolver.resolve(parseUrl("xcsh://changes"));
		const lines = result.content.split("\n");
		const newLine = lines.find(l => l.includes("#2310"));
		const oldLine = lines.find(l => l.includes("#2300"));
		expect(newLine).toBeDefined();
		expect(oldLine).toBeDefined();
		// PR merged 2026-07-23 is after the 2026-07-20 build → flagged new; the older one is not.
		expect(newLine).toContain("new since your build");
		expect(oldLine).not.toContain("new since your build");
	});

	it("passes the repo slug and a limit to gh", async () => {
		let received: string[] = [];
		const resolver = createChangesResolver({
			resolveBuildInfo: async () => fakeInfo(),
			runGh: async args => {
				received = args;
				return { ok: true, stdout: SAMPLE_PRS, stderr: "" };
			},
			now: () => new Date("2026-07-24T00:00:00Z"),
		});
		await resolver.resolve(parseUrl("xcsh://changes?limit=5"));
		expect(received).toContain("f5-sales-demo/xcsh");
		expect(received).toContain("merged");
		const limitIdx = received.indexOf("--limit");
		expect(limitIdx).toBeGreaterThanOrEqual(0);
		expect(received[limitIdx + 1]).toBe("5");
	});

	it("degrades gracefully with a fallback command when gh is unavailable (no throw)", async () => {
		const resolver = createChangesResolver({
			resolveBuildInfo: async () => fakeInfo(),
			runGh: async () => ({ ok: false, stdout: "", stderr: "gh: command not found" }),
			now: () => new Date("2026-07-24T00:00:00Z"),
		});
		const result = await resolver.resolve(parseUrl("xcsh://changes"));
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain("gh pr list");
		expect(result.content).toContain("f5-sales-demo/xcsh");
		// includes the git fallback for a local clone
		expect(result.content).toContain("git log");
	});

	it("parseMergedPrs returns [] for an empty gh array", () => {
		expect(parseMergedPrs("[]")).toEqual([]);
	});

	it("parseMergedPrs throws on malformed JSON so callers can degrade", () => {
		expect(() => parseMergedPrs("not json")).toThrow();
	});
});
