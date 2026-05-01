import { describe, expect, it } from "bun:test";
import { InternalDocsProtocolHandler, InternalUrlRouter } from "../../src/internal-urls";

function createRouter(): InternalUrlRouter {
	const router = new InternalUrlRouter();
	router.register(
		new InternalDocsProtocolHandler({
			resolveBuildInfo: async () => ({
				version: "18.29.0",
				commit: "a".repeat(40),
				shortCommit: "aaaaaaa",
				branch: "main",
				tag: "v18.29.0",
				commitDate: "2026-04-30T00:00:00Z",
				buildDate: "2026-04-30T00:00:00Z",
				dirty: false,
				prNumber: "",
				repoUrl: "https://github.com/f5xc-salesdemos/xcsh",
				repoSlug: "f5xc-salesdemos/xcsh",
				commitUrl: `https://github.com/f5xc-salesdemos/xcsh/commit/${"a".repeat(40)}`,
				releaseUrl: "https://github.com/f5xc-salesdemos/xcsh/releases/tag/v18.29.0",
				source: "live-git",
				resolvedAt: "2026-04-30T00:00:00Z",
			}),
		}),
	);
	return router;
}

describe("API spec integration — full traversal", () => {
	it("Level 1: domain index lists known stable domains", async () => {
		const result = await createRouter().resolve("xcsh://api-spec/");
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toMatch(/\d+ domains/);
		expect(result.content).toContain("dns");
		expect(result.content).toContain("cdn");
		expect(result.content).toContain("network_security");
	});

	it("Level 2: domain detail shows resources and operations for a known domain", async () => {
		const result = await createRouter().resolve("xcsh://api-spec/dns");
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain("DNS");
		expect(result.content).toContain("Operations");
		expect(result.content).toContain("dns_zone");
	});

	it("Level 3: resource spec shows full endpoint definitions", async () => {
		const result = await createRouter().resolve("xcsh://api-spec/dns?resource=dns_zone");
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain("dns_zone");
		expect(result.content).toContain("Parameters");
	});

	it("round-trip: Level 3 content is consistent with the enriched spec", async () => {
		const result = await createRouter().resolve("xcsh://api-spec/dns?resource=dns_zone");
		expect(result.content).toContain("/api/");
		expect(result.content).toContain("dns_zone");
	});

	it("traversal across multiple domains works", async () => {
		const knownDomains = ["dns", "cdn", "network_security"] as const;
		for (const domain of knownDomains) {
			const result = await createRouter().resolve(`xcsh://api-spec/${domain}`);
			expect(result.contentType).toBe("text/markdown");
			expect(result.content.length).toBeGreaterThan(0);
		}
	});
});
