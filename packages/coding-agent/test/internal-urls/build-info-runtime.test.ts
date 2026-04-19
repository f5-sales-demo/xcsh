import { describe, expect, it } from "bun:test";
import type { BuildInfo } from "../../src/internal-urls/build-info.generated";
import {
	type RuntimeBuildInfoDeps,
	renderAboutDoc,
	resolveRuntimeBuildInfo,
} from "../../src/internal-urls/build-info-runtime";

const embedded: BuildInfo = {
	version: "17.4.2",
	commit: "b".repeat(40),
	shortCommit: "bbbbbbb",
	branch: "release-build-branch",
	tag: "v17.4.2",
	commitDate: "2026-04-18T00:00:00Z",
	buildDate: "2026-04-18T12:00:00Z",
	dirty: false,
	prNumber: "42",
	repoUrl: "https://github.com/f5xc-salesdemos/xcsh",
	repoSlug: "f5xc-salesdemos/xcsh",
	commitUrl: `https://github.com/f5xc-salesdemos/xcsh/commit/${"b".repeat(40)}`,
	releaseUrl: "https://github.com/f5xc-salesdemos/xcsh/releases/tag/v17.4.2",
};

function gitFn(responses: Record<string, string>): (args: string[]) => Promise<string> {
	return async (args: string[]) => responses[args.join(" ")] ?? "";
}

function deps(overrides: Partial<RuntimeBuildInfoDeps>): RuntimeBuildInfoDeps {
	return {
		isCompiled: false,
		gitAvailable: () => true,
		git: gitFn({}),
		now: () => new Date("2026-04-19T16:00:00Z"),
		...overrides,
	};
}

describe("resolveRuntimeBuildInfo — compiled binary mode", () => {
	it("returns embedded BUILD_INFO verbatim when isCompiled=true", async () => {
		const info = await resolveRuntimeBuildInfo(embedded, deps({ isCompiled: true }));
		expect(info.commit).toBe(embedded.commit);
		expect(info.branch).toBe(embedded.branch);
		expect(info.tag).toBe(embedded.tag);
		expect(info.dirty).toBe(embedded.dirty);
		expect(info.source).toBe("compiled");
	});

	it("does not call git in compiled mode", async () => {
		let gitCalls = 0;
		const git = async (_args: string[]) => {
			gitCalls += 1;
			return "";
		};
		await resolveRuntimeBuildInfo(embedded, deps({ isCompiled: true, git }));
		expect(gitCalls).toBe(0);
	});
});

describe("resolveRuntimeBuildInfo — source mode with git", () => {
	const live = gitFn({
		"rev-parse HEAD": "a".repeat(40),
		"rev-parse --abbrev-ref HEAD": "feature/self-awareness",
		"describe --exact-match --tags HEAD": "",
		"status --porcelain": " M some-file.ts",
		"log -1 --format=%cI HEAD": "2026-04-19T10:00:00Z",
	});

	it("overrides commit with live git output", async () => {
		const info = await resolveRuntimeBuildInfo(embedded, deps({ git: live }));
		expect(info.commit).toBe("a".repeat(40));
		expect(info.shortCommit).toBe("aaaaaaa");
	});

	it("overrides branch with live git output", async () => {
		const info = await resolveRuntimeBuildInfo(embedded, deps({ git: live }));
		expect(info.branch).toBe("feature/self-awareness");
	});

	it("overrides tag as empty when current commit is not tagged", async () => {
		const info = await resolveRuntimeBuildInfo(embedded, deps({ git: live }));
		expect(info.tag).toBe("");
	});

	it("overrides dirty flag from live git status", async () => {
		const info = await resolveRuntimeBuildInfo(embedded, deps({ git: live }));
		expect(info.dirty).toBe(true);
	});

	it("overrides commit date and uses HEAD commit date", async () => {
		const info = await resolveRuntimeBuildInfo(embedded, deps({ git: live }));
		expect(info.commitDate).toBe("2026-04-19T10:00:00Z");
	});

	it("keeps version, repoUrl, and prNumber from embedded (not knowable live)", async () => {
		const info = await resolveRuntimeBuildInfo(embedded, deps({ git: live }));
		expect(info.version).toBe(embedded.version);
		expect(info.repoUrl).toBe(embedded.repoUrl);
		expect(info.prNumber).toBe(embedded.prNumber);
	});

	it("recomputes commitUrl from live commit", async () => {
		const info = await resolveRuntimeBuildInfo(embedded, deps({ git: live }));
		expect(info.commitUrl).toBe(`https://github.com/f5xc-salesdemos/xcsh/commit/${"a".repeat(40)}`);
	});

	it("marks source as live-git", async () => {
		const info = await resolveRuntimeBuildInfo(embedded, deps({ git: live }));
		expect(info.source).toBe("live-git");
	});

	it("records resolvedAt as the current clock time", async () => {
		const fixed = new Date("2026-04-19T16:00:00Z");
		const info = await resolveRuntimeBuildInfo(embedded, deps({ git: live, now: () => fixed }));
		expect(info.resolvedAt).toBe(fixed.toISOString());
	});
});

describe("resolveRuntimeBuildInfo — source mode with detached HEAD", () => {
	it("falls back to embedded branch when abbrev-ref returns HEAD and remote-contains is empty", async () => {
		const git = gitFn({
			"rev-parse HEAD": "c".repeat(40),
			"rev-parse --abbrev-ref HEAD": "HEAD",
			"branch -r --contains HEAD": "",
		});
		const info = await resolveRuntimeBuildInfo(embedded, deps({ git }));
		expect(info.branch).toBe(embedded.branch);
	});

	it("uses remote-contains first line when abbrev-ref is HEAD", async () => {
		const git = gitFn({
			"rev-parse HEAD": "c".repeat(40),
			"rev-parse --abbrev-ref HEAD": "HEAD",
			"branch -r --contains HEAD": "  origin/main\n  origin/release-17",
		});
		const info = await resolveRuntimeBuildInfo(embedded, deps({ git }));
		expect(info.branch).toBe("main");
	});
});

describe("resolveRuntimeBuildInfo — source mode, git unavailable", () => {
	it("returns embedded values when gitAvailable returns false", async () => {
		const info = await resolveRuntimeBuildInfo(embedded, deps({ gitAvailable: () => false }));
		expect(info.commit).toBe(embedded.commit);
		expect(info.branch).toBe(embedded.branch);
		expect(info.source).toBe("embedded-fallback");
	});

	it("does not call git when gitAvailable is false", async () => {
		let gitCalls = 0;
		const git = async (_args: string[]) => {
			gitCalls += 1;
			return "";
		};
		await resolveRuntimeBuildInfo(embedded, deps({ gitAvailable: () => false, git }));
		expect(gitCalls).toBe(0);
	});
});

describe("resolveRuntimeBuildInfo — tag detection at HEAD", () => {
	it("surfaces live tag when HEAD is exactly tagged", async () => {
		const git = gitFn({
			"rev-parse HEAD": "d".repeat(40),
			"rev-parse --abbrev-ref HEAD": "main",
			"describe --exact-match --tags HEAD": "v18.0.0",
			"status --porcelain": "",
		});
		const info = await resolveRuntimeBuildInfo(embedded, deps({ git }));
		expect(info.tag).toBe("v18.0.0");
	});
});

describe("renderAboutDoc", () => {
	it("includes version, short commit, branch, tag, repo URL, and source attribution", () => {
		const info = {
			...embedded,
			source: "live-git" as const,
			resolvedAt: "2026-04-19T16:00:00Z",
		};
		const md = renderAboutDoc(info);
		expect(md).toContain(embedded.version);
		expect(md).toContain(embedded.shortCommit);
		expect(md).toContain(embedded.branch);
		expect(md).toContain(embedded.tag);
		expect(md).toContain(embedded.repoUrl);
		expect(md).toContain("live-git");
	});

	it("labels the source as `compiled` when values came from the baked-in binary", () => {
		const info = {
			...embedded,
			source: "compiled" as const,
			resolvedAt: "2026-04-19T16:00:00Z",
		};
		const md = renderAboutDoc(info);
		expect(md).toContain("compiled");
	});

	it("labels the source as `embedded-fallback` when git is unavailable", () => {
		const info = {
			...embedded,
			source: "embedded-fallback" as const,
			resolvedAt: "2026-04-19T16:00:00Z",
		};
		const md = renderAboutDoc(info);
		expect(md).toContain("embedded-fallback");
	});

	it("contains the triage playbook referencing gh and git", () => {
		const info = {
			...embedded,
			source: "live-git" as const,
			resolvedAt: "2026-04-19T16:00:00Z",
		};
		const md = renderAboutDoc(info).toLowerCase();
		expect(md).toMatch(/gh pr list|git log/);
	});
});
