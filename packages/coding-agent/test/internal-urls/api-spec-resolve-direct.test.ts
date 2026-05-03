import { describe, expect, it } from "bun:test";
import { createApiSpecResolver } from "../../src/internal-urls/api-spec-resolve";
import type { ApiSpecIndex, OpenAPISpec } from "../../src/internal-urls/api-spec-types";
import type { InternalUrl } from "../../src/internal-urls/types";

const mockSpec: OpenAPISpec = {
	info: { title: "Test", version: "1.0" },
	paths: {
		"/api/test/{namespace}/resources": {
			post: { summary: "Create", operationId: "ves.io.schema.test_resource.API.Create" },
			get: { summary: "List", operationId: "ves.io.schema.test_resource.API.List" },
		},
	},
};

const mockIndex: ApiSpecIndex = {
	version: "test",
	timestamp: "2026-01-01",
	domains: [
		{
			domain: "test_domain",
			title: "Test Domain",
			description: "A test domain",
			descriptionShort: "Test",
			category: "Test",
			pathCount: 1,
			schemaCount: 1,
			complexity: "simple",
			resources: [{ name: "test_resource", description: "A test resource" }],
		},
	],
};

const mockData: Record<string, OpenAPISpec> = {
	test_domain: mockSpec,
};

function makeUrl(path: string, search?: Record<string, string>): InternalUrl {
	const params = new URLSearchParams(search);
	return {
		href: `xcsh://api-spec${path}${search ? `?${params}` : ""}`,
		hostname: "api-spec",
		rawHost: "api-spec",
		pathname: path,
		rawPathname: path,
		searchParams: params,
	} as InternalUrl;
}

describe("createApiSpecResolver — direct data (no decompression)", () => {
	it("accepts data as Record<string, OpenAPISpec> instead of blobs", () => {
		const resolver = createApiSpecResolver(mockIndex, mockData);
		expect(resolver).toBeDefined();
	});

	it("resolves domain detail from data directly", async () => {
		const resolver = createApiSpecResolver(mockIndex, mockData);
		const result = await resolver.resolve(makeUrl("/test_domain"));
		expect(result.content).toContain("Test Domain");
		expect(result.content).toContain("Operations");
	});
});
