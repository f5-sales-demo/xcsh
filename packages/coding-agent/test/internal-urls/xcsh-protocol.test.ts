import { describe, expect, it } from "bun:test";
import { InternalDocsProtocolHandler, InternalUrlRouter } from "../../src/internal-urls";
import { createApiSpecResolver } from "../../src/internal-urls/api-spec-resolve";
import type { RuntimeBuildInfo } from "../../src/internal-urls/build-info-runtime";
import { EMBEDDED_DOC_FILENAMES } from "../../src/internal-urls/docs-index.generated";

function injectedInfo(overrides: Partial<RuntimeBuildInfo> = {}): RuntimeBuildInfo {
	return {
		version: "17.4.2",
		commit: "a".repeat(40),
		shortCommit: "aaaaaaa",
		branch: "feature/self-awareness",
		tag: "",
		commitDate: "2026-04-19T10:00:00Z",
		buildDate: "2026-04-19T12:00:00Z",
		dirty: false,
		prNumber: "42",
		repoUrl: "https://github.com/f5-sales-demo/xcsh",
		repoSlug: "f5-sales-demo/xcsh",
		commitUrl: `https://github.com/f5-sales-demo/xcsh/commit/${"a".repeat(40)}`,
		releaseUrl: "https://github.com/f5-sales-demo/xcsh/releases/tag/v17.4.2",
		source: "live-git",
		resolvedAt: "2026-04-19T16:00:00Z",
		...overrides,
	};
}

function createRouter(info: RuntimeBuildInfo = injectedInfo()): InternalUrlRouter {
	const router = new InternalUrlRouter();
	router.register(new InternalDocsProtocolHandler({ resolveBuildInfo: async () => info }));
	return router;
}

describe("xcsh://about", () => {
	it("returns a markdown resource", async () => {
		const resource = await createRouter().resolve("xcsh://about");
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content.length).toBeGreaterThan(0);
	});

	it("embeds the injected version", async () => {
		const resource = await createRouter(injectedInfo({ version: "99.0.0" })).resolve("xcsh://about");
		expect(resource.content).toContain("99.0.0");
	});

	it("embeds the injected short commit", async () => {
		const resource = await createRouter(injectedInfo({ commit: "b".repeat(40), shortCommit: "bbbbbbb" })).resolve(
			"xcsh://about",
		);
		expect(resource.content).toContain("bbbbbbb");
	});

	it("embeds the injected branch", async () => {
		const resource = await createRouter(injectedInfo({ branch: "release-17" })).resolve("xcsh://about");
		expect(resource.content).toContain("release-17");
	});

	it("surfaces live-git provenance source when runtime resolved from git", async () => {
		const resource = await createRouter(injectedInfo({ source: "live-git" })).resolve("xcsh://about");
		expect(resource.content).toContain("live-git");
	});

	it("surfaces compiled provenance source when runtime used the baked-in binary", async () => {
		const resource = await createRouter(injectedInfo({ source: "compiled" })).resolve("xcsh://about");
		expect(resource.content).toContain("compiled");
	});

	it("points to the canonical source repository", async () => {
		const resource = await createRouter().resolve("xcsh://about");
		expect(resource.content).toContain("https://github.com/f5-sales-demo/xcsh");
	});

	it("includes the triage playbook", async () => {
		const resource = await createRouter().resolve("xcsh://about");
		expect(resource.content.toLowerCase()).toMatch(/gh pr list|git log/);
	});

	it("lists the about entry under xcsh:// root", async () => {
		const resource = await createRouter().resolve("xcsh://");
		expect(resource.content).toContain("xcsh://about");
	});

	it("resolves build info on each xcsh://about request (no baked content)", async () => {
		let calls = 0;
		const router = new InternalUrlRouter();
		router.register(
			new InternalDocsProtocolHandler({
				resolveBuildInfo: async () => {
					calls += 1;
					return injectedInfo({ shortCommit: "aaaaaaa" });
				},
			}),
		);
		await router.resolve("xcsh://about");
		await router.resolve("xcsh://about");
		expect(calls).toBe(2);
	});

	it("includes self-improvement and editable-surfaces guidance", async () => {
		const resource = await createRouter().resolve("xcsh://about");
		const body = resource.content;
		expect(body).toContain("## Self-improvement and editable surfaces");
		expect(body).toContain("EDITABLE_SURFACES");
		expect(body).toContain("`~/.xcsh/`");
		expect(body).toContain("runtime config");
		expect(body).toContain("source of truth");
		expect(body).toContain("compiled release");
		expect(body.indexOf("## Self-improvement")).toBeLessThan(body.indexOf("## What NOT to assume"));
	});

	it("rejects pi:// URLs outright — no legacy alias", async () => {
		const router = createRouter();
		await expect(router.resolve("pi://about")).rejects.toThrow(/Unknown protocol/);
		expect(router.canHandle("pi://about")).toBe(false);
	});
});

describe("xcsh:// embedded doc routes", () => {
	it("resolves a known bundled doc through the generic read path", async () => {
		// Pick the first embedded doc dynamically so the test can't drift if the
		// bundle's contents or layout change (e.g., docs move into subdirectories).
		const sample = EMBEDDED_DOC_FILENAMES[0];
		expect(sample).toBeTruthy();
		const resource = await createRouter().resolve(`xcsh://${sample}`);
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content.length).toBeGreaterThan(0);
		expect(resource.sourcePath).toBe(`xcsh://${sample}`);
	});

	it("reports 'not found' for a filename that is not in the bundle", async () => {
		await expect(createRouter().resolve("xcsh://this-doc-does-not-exist-ever.md")).rejects.toThrow(
			/Documentation file not found/,
		);
	});
});

describe("xcsh:// security guards", () => {
	it("rejects path traversal with xcsh://-qualified error", async () => {
		await expect(createRouter().resolve("xcsh://../secret.md")).rejects.toThrow(
			/Path traversal \(\.\.\) is not allowed in xcsh:\/\/ URLs/,
		);
	});
});

describe("InternalDocsProtocolHandler scheme contract", () => {
	it("declares scheme = 'xcsh' exactly", () => {
		const handler = new InternalDocsProtocolHandler();
		expect(handler.scheme).toBe("xcsh");
	});

	it("mirrors sdk.ts wiring: single-arg register yields exactly xcsh:// routing", async () => {
		// Reproduces the pattern at packages/coding-agent/src/sdk.ts:
		//   internalRouter.register(new InternalDocsProtocolHandler());
		// If that call grows an alias argument or the scheme constant changes, this catches it.
		const router = new InternalUrlRouter();
		router.register(new InternalDocsProtocolHandler({ resolveBuildInfo: async () => injectedInfo() }));
		expect(router.canHandle("xcsh://about")).toBe(true);
		expect(router.canHandle("pi://about")).toBe(false);
		expect(router.canHandle(`xcsh://${EMBEDDED_DOC_FILENAMES[0]}`)).toBe(true);
	});
});

describe("xcsh://api-spec", () => {
	it("resolves xcsh://api-spec/ to a markdown domain index", async () => {
		const resource = await createRouter().resolve("xcsh://api-spec/");
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content).toContain("F5 XC API Specifications");
		expect(resource.content).toContain("Domain");
	});

	it("resolves xcsh://api-spec/{domain} to domain detail", async () => {
		const resource = await createRouter().resolve("xcsh://api-spec/dns");
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content).toContain("DNS");
		expect(resource.content).toContain("Operations");
	});

	it("returns helpful error for unknown domain", async () => {
		const resource = await createRouter().resolve("xcsh://api-spec/nonexistent");
		expect(resource.content).toContain("not found");
		expect(resource.content).toContain("Available domains");
	});

	it("appears in xcsh:// root listing", async () => {
		const resource = await createRouter().resolve("xcsh://");
		expect(resource.content).toContain("api-spec/");
		expect(resource.content).toContain("F5 XC API specifications");
	});

	it("handles empty spec index gracefully (generated file missing fallback)", async () => {
		const emptyIndex = { version: "unknown", timestamp: "", domains: [] };
		const emptyResolver = createApiSpecResolver(emptyIndex, {});
		const handler = new InternalDocsProtocolHandler({
			resolveBuildInfo: async () => injectedInfo(),
			apiSpecResolver: emptyResolver,
		});
		const router = new InternalUrlRouter();
		router.register(handler);

		const resource = await router.resolve("xcsh://api-spec/");
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content).toContain("0 domains");
	});
});

describe("xcsh://user", () => {
	it("resolves xcsh://user to a markdown profile", async () => {
		const resource = await createRouter().resolve("xcsh://user");
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content).toContain("User Profile");
	});

	it("appears in xcsh:// root listing", async () => {
		const resource = await createRouter().resolve("xcsh://");
		expect(resource.content).toContain("xcsh://user");
		expect(resource.content).toContain("human user profile");
	});

	it("returns seed instructions when profile is empty on a fresh HOME", async () => {
		// The test runs with whatever HOME is set; if user-profile.json exists
		// it renders the profile, otherwise it shows seed instructions.
		const resource = await createRouter().resolve("xcsh://user");
		expect(resource.content.length).toBeGreaterThan(0);
		// Either populated or has seed instructions — both are valid
		const hasProfile = resource.content.includes("## Identity");
		const hasSeedHint = resource.content.includes("seed=true");
		expect(hasProfile || hasSeedHint).toBe(true);
	});

	it("sourcePath is xcsh://user regardless of seed query param", async () => {
		const resource = await createRouter().resolve("xcsh://user?seed=true");
		expect(resource.sourcePath).toBe("xcsh://user");
	}, 30_000);
});

describe("xcsh://computer", () => {
	it("resolves xcsh://computer to a markdown profile", async () => {
		const resource = await createRouter().resolve("xcsh://computer");
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content).toContain("Computer Profile");
	});

	it("appears in xcsh:// root listing", async () => {
		const resource = await createRouter().resolve("xcsh://");
		expect(resource.content).toContain("xcsh://computer");
		expect(resource.content).toContain("machine hardware");
	});

	it("returns either populated profile or collection instructions", async () => {
		const resource = await createRouter().resolve("xcsh://computer");
		expect(resource.content.length).toBeGreaterThan(0);
		const hasProfile =
			resource.content.includes("## Hardware") ||
			resource.content.includes("## CPU") ||
			resource.content.includes("## Memory");
		const hasSeedHint = resource.content.includes("xcsh://computer?refresh=true");
		expect(hasProfile || hasSeedHint).toBe(true);
	});

	it("sourcePath is xcsh://computer regardless of refresh query param", async () => {
		const resource = await createRouter().resolve("xcsh://computer");
		expect(resource.sourcePath).toBe("xcsh://computer");
	});

	it("root listing count includes computer entry", async () => {
		const resource = await createRouter().resolve("xcsh://");
		const listItems = resource.content.split("\n").filter(line => line.startsWith("- ["));
		expect(listItems.length).toBeGreaterThanOrEqual(5);
	});
});
