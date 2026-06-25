import { describe, expect, it } from "bun:test";
import { createApiCatalogResolver } from "../../src/internal-urls/api-catalog-resolve";
import type {
	ApiCatalogCategory,
	ApiCatalogCategorySummary,
	ApiCatalogIndex,
} from "../../src/internal-urls/api-catalog-types";
import type { InternalUrl } from "../../src/internal-urls/types";

const mockIndex: ApiCatalogIndex = {
	version: "test",
	displayName: "Test",
	service: "test",
	categoryCount: 1,
	auth: {
		type: "api_token",
		headerName: "Authorization",
		headerTemplate: "APIToken {token}",
		tokenSource: "XCSH_API_TOKEN",
		baseUrlSource: "XCSH_API_URL",
	},
	defaults: {},
};

const mockCategory: ApiCatalogCategory = {
	name: "test-category",
	displayName: "Test Category",
	operations: [
		{
			name: "Create test",
			description: "Creates a test resource",
			method: "post",
			path: "/api/test/{namespace}/resources",
			dangerLevel: "low",
			parameters: [],
		},
	],
};

const mockSummaries: ApiCatalogCategorySummary[] = [
	{ name: "test-category", displayName: "Test Category", operationCount: 1 },
];

const mockData: Record<string, ApiCatalogCategory> = {
	"test-category": mockCategory,
};

function makeUrl(path: string, search?: Record<string, string>): InternalUrl {
	const params = new URLSearchParams(search);
	return {
		href: `xcsh://api-catalog${path}${search ? `?${params}` : ""}`,
		hostname: "api-catalog",
		rawHost: "api-catalog",
		pathname: path,
		rawPathname: path,
		searchParams: params,
	} as InternalUrl;
}

describe("createApiCatalogResolver — direct data (no decompression)", () => {
	it("accepts data as Record<string, ApiCatalogCategory> instead of blobs", () => {
		const resolver = createApiCatalogResolver(mockIndex, mockSummaries, mockData);
		expect(resolver).toBeDefined();
	});

	it("resolves a category from data directly", async () => {
		const resolver = createApiCatalogResolver(mockIndex, mockSummaries, mockData);
		const result = await resolver.resolve(makeUrl("/test-category"));
		expect(result.content).toContain("Test Category");
		expect(result.content).toContain("POST");
	});
});
