import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
	buildApiCatalogDiscoveryCorpus,
	extractPrebuiltQmdBm25Index,
	fingerprintApiCatalogDiscoveryCorpus,
	rankBaselineCatalogDiscovery,
} from "../../src/internal-urls/api-catalog-discovery";
import { API_CATALOG_CATEGORY_SUMMARIES } from "../../src/internal-urls/api-catalog-index.generated";
import type { ApiCatalogCategory, ApiCatalogIndex } from "../../src/internal-urls/api-catalog-types";

const index: ApiCatalogIndex = {
	version: "test-catalog-v1",
	displayName: "Test",
	service: "xcsh",
	categoryCount: 2,
	auth: {
		type: "apiToken",
		headerName: "Authorization",
		headerTemplate: "APIToken $TOKEN",
		tokenSource: "TOKEN",
		baseUrlSource: "URL",
	},
	defaults: {},
};

const categories: Record<string, ApiCatalogCategory> = {
	"dns-zones": {
		name: "dns-zones",
		displayName: "DNS Zones",
		operations: [
			{
				name: "create_dns_zone",
				operationId: "ves.io.schema.dns_zone.API.Create",
				operationAliases: ["create zone"],
				description: "Create an authoritative DNS zone",
				method: "POST",
				path: "/api/config/dns/namespaces/{namespace}/dns_zones",
				dangerLevel: "medium",
				parameters: [],
			},
		],
	},
	"http-loadbalancers": {
		name: "http-loadbalancers",
		displayName: "HTTP Load Balancers",
		operations: [],
	},
};

describe("API catalog discovery corpus", () => {
	it("keeps the frozen retrieval corpus complete, split, and authoritative", async () => {
		const fixture = await Bun.file(
			path.join(import.meta.dir, "../../bench/fixtures/api-catalog-retrieval-v1.json"),
		).json();
		const queries = fixture.queries as Array<{
			id: string;
			split: string;
			class: string;
			expectedCategories: string[];
		}>;
		const categories = new Set(API_CATALOG_CATEGORY_SUMMARIES.map(category => category.name));

		expect(queries).toHaveLength(60);
		expect(queries.filter(query => query.split === "tuning")).toHaveLength(40);
		expect(queries.filter(query => query.split === "sealed")).toHaveLength(20);
		for (const kind of ["exact", "alias", "semantic", "topical", "cross-domain", "ambiguous-no-match"]) {
			expect(queries.filter(query => query.class === kind)).toHaveLength(10);
		}
		expect(new Set(queries.map(query => query.id)).size).toBe(60);
		for (const query of queries) {
			for (const category of query.expectedCategories) expect(categories.has(category)).toBe(true);
		}
	});

	it("is byte-deterministic and carries authoritative destinations", () => {
		const first = buildApiCatalogDiscoveryCorpus(index, categories);
		const second = buildApiCatalogDiscoveryCorpus(index, categories);

		expect(first).toEqual(second);
		expect(first.documents.map(document => document.id)).toEqual([
			"category:dns-zones",
			"category:http-loadbalancers",
		]);
		expect(first.documents[0]?.markdown).toContain("xcsh://api-catalog/dns-zones");
		expect(first.documents[0]?.markdown).toContain("create zone");
		expect(fingerprintApiCatalogDiscoveryCorpus(first, "source-sha", "baseline-v1")).toMatch(/^[a-f0-9]{64}$/);
	});

	it("keeps the baseline category matching semantics deterministic", () => {
		const corpus = buildApiCatalogDiscoveryCorpus(index, categories);
		expect(rankBaselineCatalogDiscovery("dns zone", corpus).map(candidate => candidate.categoryName)).toEqual([
			"dns-zones",
		]);
		expect(rankBaselineCatalogDiscovery("absent thing", corpus)).toEqual([]);
	});

	it("atomically repairs a stale prebuilt-index cache and reuses a verified warm index", async () => {
		const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "xcsh-qmd-cache-"));
		const sqlite = Buffer.from("verified test index");
		const fingerprint = "test-stale-cache";
		const options = {
			cacheRoot,
			prebuiltIndex: {
				fingerprint,
				sqliteSha256: createHash("sha256").update(sqlite).digest("hex"),
				gzipBase64: gzipSync(sqlite).toString("base64"),
			},
		};
		try {
			const cold = await extractPrebuiltQmdBm25Index(options);
			expect(Buffer.from(await Bun.file(cold).bytes())).toEqual(sqlite);
			expect(await extractPrebuiltQmdBm25Index(options)).toBe(cold);

			const staleOptions = {
				...options,
				prebuiltIndex: { ...options.prebuiltIndex, fingerprint: "test-stale-repair" },
			};
			const staleDirectory = path.join(cacheRoot, staleOptions.prebuiltIndex.fingerprint);
			await mkdir(staleDirectory, { recursive: true });
			await Bun.write(path.join(staleDirectory, "index.sqlite"), "corrupt");
			const repaired = await extractPrebuiltQmdBm25Index(staleOptions);
			expect(Buffer.from(await Bun.file(repaired).bytes())).toEqual(sqlite);
		} finally {
			await rm(cacheRoot, { recursive: true, force: true });
		}
	});
});
