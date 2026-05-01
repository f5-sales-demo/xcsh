import { describe, expect, it } from "bun:test";
import * as zlib from "node:zlib";
import { createApiCatalogResolver } from "../../src/internal-urls/api-catalog-resolve";
import type { ApiCatalogIndex } from "../../src/internal-urls/api-catalog-types";
import type { InternalUrl } from "../../src/internal-urls/types";

const testCatalogIndex: ApiCatalogIndex = {
	version: "2.1.63",
	displayName: "F5 Distributed Cloud",
	service: "f5xc",
	categoryCount: 2,
	auth: {
		type: "apiToken",
		headerName: "Authorization",
		headerTemplate: "APIToken $TOKEN",
		tokenSource: "F5XC_API_TOKEN",
		baseUrlSource: "F5XC_API_URL",
	},
	defaults: { namespace: { source: "F5XC_NAMESPACE" } },
};

const testCategorySummaries = [
	{ name: "dns-zone", displayName: "DNS Zone", operationCount: 2 },
	{ name: "http-loadbalancer", displayName: "HTTP Load Balancer", operationCount: 1 },
];

function compressCategory(cat: Record<string, unknown>): string {
	return zlib.gzipSync(Buffer.from(JSON.stringify(cat))).toString("base64");
}

const testCatalogBlobs: Record<string, string> = {
	"dns-zone": compressCategory({
		name: "dns-zone",
		displayName: "DNS Zone",
		operations: [
			{
				name: "create_dns_zone",
				description: "Create a DNS zone",
				method: "POST",
				path: "/api/config/dns/namespaces/{namespace}/dns_zones",
				dangerLevel: "medium",
				parameters: [{ name: "namespace", in: "path", required: true, type: "string", default: "$F5XC_NAMESPACE" }],
				bodySchema: { type: "object", properties: { name: { type: "string" } } },
			},
			{
				name: "list_dns_zones",
				description: "List DNS zones",
				method: "GET",
				path: "/api/config/dns/namespaces/{namespace}/dns_zones",
				dangerLevel: "low",
				parameters: [{ name: "namespace", in: "path", required: true, type: "string", default: "$F5XC_NAMESPACE" }],
			},
		],
	}),
	"http-loadbalancer": compressCategory({
		name: "http-loadbalancer",
		displayName: "HTTP Load Balancer",
		operations: [
			{
				name: "create_http_lb",
				description: "Create HTTP load balancer",
				method: "POST",
				path: "/api/config/namespaces/{namespace}/http_loadbalancers",
				dangerLevel: "high",
				parameters: [{ name: "namespace", in: "path", required: true, type: "string" }],
			},
		],
	}),
};

function parseUrl(urlStr: string): InternalUrl {
	const url = new URL(urlStr) as InternalUrl;
	const match = urlStr.match(/^xcsh:\/\/([^/?#]+)(\/[^?#]*)?/);
	url.rawHost = match?.[1] ?? "";
	url.rawPathname = match?.[2] ?? "/";
	return url;
}

describe("API Catalog Resolver", () => {
	it("renders catalog index with all categories", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogBlobs);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/"));
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain("dns-zone");
		expect(result.content).toContain("DNS Zone");
		expect(result.content).toContain("http-loadbalancer");
	});

	it("filters categories by search term", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogBlobs);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/?search=dns"));
		expect(result.content).toContain("dns-zone");
		expect(result.content).not.toContain("http-loadbalancer");
	});

	it("search is case-insensitive", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogBlobs);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/?search=DNS"));
		expect(result.content).toContain("dns-zone");
	});

	it("renders category detail with operations", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogBlobs);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/dns-zone"));
		expect(result.content).toContain("POST");
		expect(result.content).toContain("/api/config/dns/namespaces/{namespace}/dns_zones");
		expect(result.content).toContain("Create a DNS zone");
		expect(result.content).toContain("medium");
	});

	it("renders curl template for operations", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogBlobs);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/dns-zone"));
		expect(result.content).toContain("curl");
		expect(result.content).toContain("$F5XC_API_URL");
		expect(result.content).toContain("$F5XC_API_TOKEN");
	});

	it("returns helpful error for unknown category", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogBlobs);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/nonexistent"));
		expect(result.content).toContain("not found");
	});

	it("renders parameters in category detail", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogBlobs);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/dns-zone"));
		expect(result.content).toContain("namespace");
		expect(result.content).toContain("$F5XC_NAMESPACE");
	});
});
