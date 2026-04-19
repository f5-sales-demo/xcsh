import { describe, expect, it } from "bun:test";
import { InternalUrlRouter, PiProtocolHandler } from "../../src/internal-urls";
import type { RuntimeBuildInfo } from "../../src/internal-urls/build-info-runtime";

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
		repoUrl: "https://github.com/f5xc-salesdemos/xcsh",
		repoSlug: "f5xc-salesdemos/xcsh",
		commitUrl: `https://github.com/f5xc-salesdemos/xcsh/commit/${"a".repeat(40)}`,
		releaseUrl: "https://github.com/f5xc-salesdemos/xcsh/releases/tag/v17.4.2",
		source: "live-git",
		resolvedAt: "2026-04-19T16:00:00Z",
		...overrides,
	};
}

function createRouter(info: RuntimeBuildInfo = injectedInfo()): InternalUrlRouter {
	const router = new InternalUrlRouter();
	router.register(new PiProtocolHandler({ resolveBuildInfo: async () => info }));
	return router;
}

describe("PiProtocolHandler pi://about", () => {
	it("returns a markdown resource", async () => {
		const resource = await createRouter().resolve("pi://about");
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content.length).toBeGreaterThan(0);
	});

	it("embeds the injected version", async () => {
		const resource = await createRouter(injectedInfo({ version: "99.0.0" })).resolve("pi://about");
		expect(resource.content).toContain("99.0.0");
	});

	it("embeds the injected short commit", async () => {
		const resource = await createRouter(injectedInfo({ commit: "b".repeat(40), shortCommit: "bbbbbbb" })).resolve(
			"pi://about",
		);
		expect(resource.content).toContain("bbbbbbb");
	});

	it("embeds the injected branch", async () => {
		const resource = await createRouter(injectedInfo({ branch: "release-17" })).resolve("pi://about");
		expect(resource.content).toContain("release-17");
	});

	it("surfaces live-git provenance source when runtime resolved from git", async () => {
		const resource = await createRouter(injectedInfo({ source: "live-git" })).resolve("pi://about");
		expect(resource.content).toContain("live-git");
	});

	it("surfaces compiled provenance source when runtime used the baked-in binary", async () => {
		const resource = await createRouter(injectedInfo({ source: "compiled" })).resolve("pi://about");
		expect(resource.content).toContain("compiled");
	});

	it("points to the canonical source repository", async () => {
		const resource = await createRouter().resolve("pi://about");
		expect(resource.content).toContain("https://github.com/f5xc-salesdemos/xcsh");
	});

	it("includes the triage playbook", async () => {
		const resource = await createRouter().resolve("pi://about");
		expect(resource.content.toLowerCase()).toMatch(/gh pr list|git log/);
	});

	it("lists the about entry under pi:// root", async () => {
		const resource = await createRouter().resolve("pi://");
		expect(resource.content).toContain("pi://about");
	});

	it("resolves build info on each pi://about request (no baked content)", async () => {
		let calls = 0;
		const router = new InternalUrlRouter();
		router.register(
			new PiProtocolHandler({
				resolveBuildInfo: async () => {
					calls += 1;
					return injectedInfo({ shortCommit: "aaaaaaa" });
				},
			}),
		);
		await router.resolve("pi://about");
		await router.resolve("pi://about");
		expect(calls).toBe(2);
	});
});
