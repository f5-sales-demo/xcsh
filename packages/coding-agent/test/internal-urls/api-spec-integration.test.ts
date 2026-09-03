import { describe, expect, it } from "bun:test";
import { InternalDocsProtocolHandler, InternalUrlRouter } from "../../src/internal-urls";
import {
	API_CATALOG_CATEGORY_SUMMARIES,
	API_CATALOG_DATA,
	API_CATALOG_INDEX,
} from "../../src/internal-urls/api-catalog-index.generated";
import { createApiCatalogResolver } from "../../src/internal-urls/api-catalog-resolve";
import { API_SPEC_INDEX } from "../../src/internal-urls/api-spec-index.generated";
import type { InternalUrl } from "../../src/internal-urls/types";

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
				repoUrl: "https://github.com/f5-sales-demo/xcsh",
				repoSlug: "f5-sales-demo/xcsh",
				commitUrl: `https://github.com/f5-sales-demo/xcsh/commit/${"a".repeat(40)}`,
				releaseUrl: "https://github.com/f5-sales-demo/xcsh/releases/tag/v18.29.0",
				source: "live-git",
				resolvedAt: "2026-04-30T00:00:00Z",
			}),
		}),
	);
	return router;
}

function catalogUrl(value: string): InternalUrl {
	const url = new URL(value) as InternalUrl;
	const match = value.match(/^xcsh:\/\/([^/?#]+)(\/[^?#]*)?/);
	url.rawHost = match?.[1] ?? "";
	url.rawPathname = match?.[2] ?? "/";
	return url;
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

	it("Level 1: domain index includes icon and tier columns", async () => {
		const result = await createRouter().resolve("xcsh://api-spec/");
		expect(result.content).toContain("Icon");
		expect(result.content).toContain("Tier");
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

	it("workflows index renders", async () => {
		const result = await createRouter().resolve("xcsh://api-spec/workflows/");
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain("Guided");
	});

	it("errors index renders", async () => {
		const result = await createRouter().resolve("xcsh://api-spec/errors/");
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain("401");
	});

	it("glossary renders acronym table", async () => {
		const result = await createRouter().resolve("xcsh://api-spec/glossary/");
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain("Acronym");
	});

	it("Level 3: resource spec shows healthcheck CRUD operations with schema fields", async () => {
		const result = await createRouter().resolve("xcsh://api-spec/virtual?resource=healthcheck");
		expect(result.content).toContain("POST /api/config/namespaces/");
		expect(result.content).toContain("healthchecks");
		expect(result.content).toContain("Create Health Check");
		expect(result.content).toContain("GET /api/config/namespaces/");
		expect(result.content).toContain("DELETE /api/config/namespaces/");
		expect(result.content).toContain("metadata");
		expect(result.content).toContain("spec");
		expect(result.content).toContain("namespace");
	});
});

describe("API catalog integration — full traversal", () => {
	it("catalog index lists categories", async () => {
		const result = await createRouter().resolve("xcsh://api-catalog/");
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain("Category");
	});

	it("catalog search filters categories", async () => {
		const result = await createRouter().resolve("xcsh://api-catalog/?search=dns");
		expect(result.contentType).toBe("text/markdown");
	});

	it("real generated data resolves DNS Zone to its five canonical CRUD operations", async () => {
		const resolver = createApiCatalogResolver(
			API_CATALOG_INDEX,
			API_CATALOG_CATEGORY_SUMMARIES,
			API_CATALOG_DATA,
			API_SPEC_INDEX,
		);
		const result = await resolver.resolve(catalogUrl("xcsh://api-catalog/?resource=dns_zone&compact=true"));
		expect(result.content).toContain("# Dns Dns Zones");
		for (const method of ["POST", "PUT", "DELETE"]) expect(result.content).toContain(`## ${method} `);
		expect(result.content.match(/^## GET /gm)).toHaveLength(2);
		expect(result.content).not.toContain("health_status");
	});

	it("real generated search labels DNS Zone CRUD ahead of ancillary operations", async () => {
		const resolver = createApiCatalogResolver(
			API_CATALOG_INDEX,
			API_CATALOG_CATEGORY_SUMMARIES,
			API_CATALOG_DATA,
			API_SPEC_INDEX,
		);
		const result = await resolver.resolve(catalogUrl("xcsh://api-catalog/?search=dns%20zone"));
		expect(result.content).toContain("dns-dns-zones | Dns Dns Zones | canonical CRUD");
		expect(result.content.indexOf("canonical CRUD")).toBeLessThan(result.content.indexOf("ancillary"));
	});

	it("real generated RRset category contains the exact flat TXT request", () => {
		const rrset = API_CATALOG_DATA["dns-dns-zones-rrsets"];
		const create = rrset?.operations.find(
			operation => operation.operationId === "ves.io.schema.dns_zone.rrset.CustomAPI.Create",
		);
		expect(create?.minimumPayload?.json).toEqual({
			dns_zone_name: "example.com",
			group_name: "github-pages-verification",
			rrset: {
				ttl: 300,
				txt_record: {
					name: "_github-pages-challenge-example",
					values: ["verification-value"],
				},
			},
		});
	});
});
