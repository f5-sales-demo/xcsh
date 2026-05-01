import { describe, expect, it } from "bun:test";
import { InternalDocsProtocolHandler, InternalUrlRouter } from "../../src/internal-urls";
import { API_SPEC_INDEX } from "../../src/internal-urls/api-spec-index.generated";

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
	it("Level 1: domain index lists all domains from generated index", async () => {
		const result = await createRouter().resolve("xcsh://api-spec/");
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain(`${API_SPEC_INDEX.domains.length} domains`);

		for (const domain of API_SPEC_INDEX.domains) {
			expect(result.content).toContain(domain.domain);
		}
	});

	it("Level 2: domain detail shows resources and operations for a known domain", async () => {
		const dnsDomain = API_SPEC_INDEX.domains.find(d => d.domain === "dns");
		expect(dnsDomain).toBeDefined();

		const result = await createRouter().resolve("xcsh://api-spec/dns");
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain("DNS");
		expect(result.content).toContain("Operations");

		for (const resource of dnsDomain?.resources ?? []) {
			expect(result.content).toContain(resource.name);
		}
	});

	it("Level 3: resource spec shows full endpoint definitions", async () => {
		const dnsDomain = API_SPEC_INDEX.domains.find(d => d.domain === "dns");
		const firstResource = dnsDomain?.resources[0];
		expect(firstResource).toBeDefined();

		const result = await createRouter().resolve(`xcsh://api-spec/dns?resource=${firstResource?.name}`);
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain(firstResource?.name ?? "");
		expect(result.content).toContain("Parameters");
	});

	it("round-trip: Level 3 content is consistent with the enriched spec", async () => {
		const result = await createRouter().resolve("xcsh://api-spec/dns?resource=dns_zone");
		expect(result.content).toContain("/api/");
		expect(result.content).toContain("dns_zone");
	});

	it("traversal across multiple domains works", async () => {
		const domainsToTest = API_SPEC_INDEX.domains.slice(0, 3);
		for (const domain of domainsToTest) {
			const result = await createRouter().resolve(`xcsh://api-spec/${domain.domain}`);
			expect(result.contentType).toBe("text/markdown");
			expect(result.content).toContain(domain.title);
		}
	});
});
