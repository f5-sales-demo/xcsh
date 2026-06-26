import { describe, expect, it } from "bun:test";
import type { BuildInfo } from "../../src/internal-urls/build-info.generated";
import {
	formatRelativeTime,
	type RuntimeBuildInfo,
	type RuntimeBuildInfoDeps,
	renderAboutDoc,
	resolveRuntimeBuildInfo,
} from "../../src/internal-urls/build-info-runtime";
import type { ContextStatus } from "../../src/services/xcsh-context";

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
	repoUrl: "https://github.com/f5-sales-demo/xcsh",
	repoSlug: "f5-sales-demo/xcsh",
	commitUrl: `https://github.com/f5-sales-demo/xcsh/commit/${"b".repeat(40)}`,
	releaseUrl: "https://github.com/f5-sales-demo/xcsh/releases/tag/v17.4.2",
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
		expect(info.commitUrl).toBe(`https://github.com/f5-sales-demo/xcsh/commit/${"a".repeat(40)}`);
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
		const md = renderAboutDoc(info, null);
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
		const md = renderAboutDoc(info, null);
		expect(md).toContain("compiled");
	});

	it("labels the source as `embedded-fallback` when git is unavailable", () => {
		const info = {
			...embedded,
			source: "embedded-fallback" as const,
			resolvedAt: "2026-04-19T16:00:00Z",
		};
		const md = renderAboutDoc(info, null);
		expect(md).toContain("embedded-fallback");
	});

	it("contains the triage playbook referencing gh and git", () => {
		const info = {
			...embedded,
			source: "live-git" as const,
			resolvedAt: "2026-04-19T16:00:00Z",
		};
		const md = renderAboutDoc(info, null).toLowerCase();
		expect(md).toMatch(/gh pr list|git log/);
	});

	it("warns against xcsh --version for version identification and marks embedded version as authoritative", () => {
		const info = {
			...embedded,
			source: "live-git" as const,
			resolvedAt: "2026-04-19T16:00:00Z",
		};
		const md = renderAboutDoc(info, null);
		const mdLower = md.toLowerCase();
		// Must NOT recommend xcsh --version in a positive/confirming context
		expect(md).not.toMatch(/ask them to run.*xcsh --version/i);
		expect(md).not.toMatch(/if unsure.*xcsh --version/i);
		// Must warn that xcsh --version checks the installed binary, not the running session
		expect(mdLower).toMatch(/do not.*xcsh --version/);
		expect(mdLower).toContain("installed binary");
		expect(mdLower).toContain("running session");
		// Must mark the embedded version as authoritative
		expect(mdLower).toContain("authoritative");
		expect(mdLower).toContain("embedded");
		expect(mdLower).toContain("build time");
		// Must reference the workstation header
		expect(mdLower).toContain("workstation");
	});

	it("names the federated llms.txt index as the product knowledge entry point", () => {
		const info = {
			...embedded,
			source: "live-git" as const,
			resolvedAt: "2026-04-19T16:00:00Z",
		};
		const md = renderAboutDoc(info, null);
		expect(md).toContain("## Product knowledge");
		expect(md).toContain("https://f5-sales-demo.github.io/docs/llms.txt");
		expect(md).toContain("federated");
	});

	it("includes lineage, architecture map, and capabilities summary (P6)", () => {
		const info = {
			...embedded,
			source: "live-git" as const,
			resolvedAt: "2026-04-19T16:00:00Z",
		};
		const md = renderAboutDoc(info, null);
		expect(md).toContain("## Lineage");
		expect(md).toContain("badlogic/pi-mono");
		expect(md).toContain("## Architecture");
		// Package map names
		expect(md).toContain("`coding-agent`");
		expect(md).toContain("`agent`");
		expect(md).toContain("`ai`");
		expect(md).toContain("`tui`");
		expect(md).toContain("`natives`");
		expect(md).toContain("## Capabilities");
		expect(md).toContain("MCP server/client");
		expect(md).toContain("F5 XC federated product docs");
	});
	it("lists SE specialization capabilities alongside platform capabilities", () => {
		const info = {
			...embedded,
			source: "live-git" as const,
			resolvedAt: "2026-04-19T16:00:00Z",
		};
		const md = renderAboutDoc(info, null);
		// Platform capabilities (inherited)
		expect(md).toContain("MCP server/client");
		expect(md).toContain("slash commands");
		// SE specialization layer (must not be omitted)
		expect(md).toContain("F5 XC API integration");
		expect(md).toContain("xcsh://user");
		expect(md).toContain("xcsh://computer");
		expect(md).toContain("deal-analyst");
		expect(md).toContain("api-catalog");
	});
});

function fakeBuildInfo(): RuntimeBuildInfo {
	return {
		version: "18.14.0",
		commit: "abc1234deadbeef",
		shortCommit: "abc1234",
		branch: "main",
		tag: "",
		commitDate: "2026-04-23T00:00:00Z",
		buildDate: "2026-04-23T00:00:00Z",
		dirty: false,
		prNumber: "",
		repoUrl: "https://github.com/f5-sales-demo/xcsh",
		repoSlug: "f5-sales-demo/xcsh",
		commitUrl: "https://github.com/f5-sales-demo/xcsh/commit/abc1234deadbeef",
		releaseUrl: "https://github.com/f5-sales-demo/xcsh/releases/tag/v18.14.0",
		source: "live-git",
		resolvedAt: "2026-04-23T00:00:00Z",
	};
}

describe("formatRelativeTime", () => {
	it("renders 'just now' for sub-60-second deltas", () => {
		const now = 1_700_000_000_000;
		expect(formatRelativeTime(now - 0, now)).toBe("just now");
		expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
		expect(formatRelativeTime(now - 59_999, now)).toBe("just now");
	});

	it("renders 'N min ago' for 1–59 minutes", () => {
		const now = 1_700_000_000_000;
		expect(formatRelativeTime(now - 60_000, now)).toBe("1 min ago");
		expect(formatRelativeTime(now - 3 * 60_000, now)).toBe("3 min ago");
		expect(formatRelativeTime(now - 59 * 60_000, now)).toBe("59 min ago");
	});

	it("renders 'N hours ago' for 1–23 hours", () => {
		const now = 1_700_000_000_000;
		expect(formatRelativeTime(now - 60 * 60_000, now)).toBe("1 hour ago");
		expect(formatRelativeTime(now - 2 * 60 * 60_000, now)).toBe("2 hours ago");
		expect(formatRelativeTime(now - 23 * 60 * 60_000, now)).toBe("23 hours ago");
	});

	it("renders 'N days ago' for deltas of 24 hours or more", () => {
		const now = 1_700_000_000_000;
		expect(formatRelativeTime(now - 24 * 60 * 60_000, now)).toBe("1 day ago");
		expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe("3 days ago");
	});
});

describe("renderAboutDoc platform context section", () => {
	it("renders the unconfigured message when context is null", () => {
		const doc = renderAboutDoc(fakeBuildInfo(), null);
		expect(doc).toContain("## Current Platform Context");
		expect(doc).toContain("No F5 XC context active");
		expect(doc).toContain("/context create");
		expect(doc).toContain("/context activate");
	});

	it("renders tenant/namespace/status/source when a context is active with fresh latency", () => {
		const now = Date.now();
		const context: ContextStatus = {
			activeContextName: "prod",
			activeContextUrl: "https://acme-corp.console.ves.volterra.io/api",
			activeContextTenant: "acme-corp",
			activeContextNamespace: "production",
			credentialSource: "context",
			authStatus: "connected",
			isConfigured: true,
			authLatencyMs: 142,
			authCheckedAt: now - 3 * 60_000, // 3 min ago
		};
		const doc = renderAboutDoc(fakeBuildInfo(), context);
		expect(doc).toContain("**Tenant:** acme-corp");
		expect(doc).toContain("**Namespace:** production");
		expect(doc).toContain("**Auth Status:** connected (latency: 142ms, checked: 3 min ago)");
		expect(doc).toContain("**Credential Source:** context (name: prod)");
	});

	it("renders auth status without latency suffix when authCheckedAt is absent", () => {
		const context: ContextStatus = {
			activeContextName: "prod",
			activeContextUrl: "https://acme-corp.console.ves.volterra.io/api",
			activeContextTenant: "acme-corp",
			activeContextNamespace: "production",
			credentialSource: "context",
			authStatus: "unknown",
			isConfigured: true,
		};
		const doc = renderAboutDoc(fakeBuildInfo(), context);
		expect(doc).toContain("**Auth Status:** unknown");
		expect(doc).not.toContain("latency:");
		expect(doc).not.toContain("checked:");
	});

	it("falls back to unconfigured message when context.isConfigured is false", () => {
		const context: ContextStatus = {
			activeContextName: null,
			activeContextUrl: null,
			activeContextTenant: null,
			activeContextNamespace: null,
			credentialSource: "none",
			authStatus: "unknown",
			isConfigured: false,
		};
		const doc = renderAboutDoc(fakeBuildInfo(), context);
		expect(doc).toContain("No F5 XC context active");
	});

	it("omits '(name: ...)' suffix when credential source is not 'context'", () => {
		const context: ContextStatus = {
			activeContextName: "prod",
			activeContextUrl: "https://acme-corp.console.ves.volterra.io/api",
			activeContextTenant: "acme-corp",
			activeContextNamespace: "production",
			credentialSource: "environment",
			authStatus: "connected",
			isConfigured: true,
		};
		const doc = renderAboutDoc(fakeBuildInfo(), context);
		expect(doc).toContain("**Credential Source:** environment");
		expect(doc).not.toContain("environment (name:");
	});

	it("renders platform context for env-backed sessions with no activeContextName", () => {
		// Regression test: xcsh launched with XCSH_API_URL / XCSH_API_TOKEN has isConfigured=true,
		// credentialSource='environment', a derived tenant, and activeContextName=null. Previously
		// the guard rejected this case and printed "the guard rejected this case and printed "No F5 XC context active"; now it should render
		// the configured section so users see the tenant/namespace they're actually connected to.
		const context: ContextStatus = {
			activeContextName: null,
			activeContextUrl: "https://acme-corp.console.ves.volterra.io/api",
			activeContextTenant: "acme-corp",
			activeContextNamespace: "production",
			credentialSource: "environment",
			authStatus: "connected",
			isConfigured: true,
		};
		const doc = renderAboutDoc(fakeBuildInfo(), context);
		expect(doc).toContain("- **Tenant:** acme-corp");
		expect(doc).toContain("- **Namespace:** production");
		expect(doc).toContain("**Auth Status:** connected");
		expect(doc).toContain("**Credential Source:** environment");
		// No `(name: ...)` suffix for env-only, since there's no context name to show.
		expect(doc).not.toContain("environment (name:");
		// Must NOT fall through to the unconfigured message.
		expect(doc).not.toContain("No F5 XC context active");
	});
});
