import { describe, expect, it } from "bun:test";
import { createApiCatalogResolver } from "../../src/internal-urls/api-catalog-resolve";
import type { ApiCatalogCategory, ApiCatalogIndex } from "../../src/internal-urls/api-catalog-types";
import type { ApiSpecIndex } from "../../src/internal-urls/api-spec-types";
import type { InternalUrl } from "../../src/internal-urls/types";

const testCatalogIndex: ApiCatalogIndex = {
	version: "2.1.63",
	displayName: "F5 Distributed Cloud",
	service: "xcsh",
	categoryCount: 2,
	auth: {
		type: "apiToken",
		headerName: "Authorization",
		headerTemplate: "APIToken $TOKEN",
		tokenSource: "XCSH_API_TOKEN",
		baseUrlSource: "XCSH_API_URL",
	},
	defaults: { namespace: { source: "XCSH_NAMESPACE" } },
};

const testCategorySummaries = [
	{ name: "dns-zone", displayName: "DNS Zone", operationCount: 2 },
	{ name: "http-loadbalancer", displayName: "HTTP Load Balancer", operationCount: 1 },
];

const testCatalogData: Record<string, ApiCatalogCategory> = {
	"dns-zone": {
		name: "dns-zone",
		displayName: "DNS Zone",
		operations: [
			{
				name: "create_dns_zone",
				operationId: "test.create_dns_zone",
				description: "Create a DNS zone",
				method: "POST",
				path: "/api/config/dns/namespaces/{namespace}/dns_zones",
				dangerLevel: "medium",
				parameters: [{ name: "namespace", in: "path", required: true, type: "string", default: "$XCSH_NAMESPACE" }],
				bodySchema: { type: "object", properties: { name: { type: "string" } } },
			},
			{
				name: "list_dns_zones",
				operationId: "test.list_dns_zones",
				description: "List DNS zones",
				method: "GET",
				path: "/api/config/dns/namespaces/{namespace}/dns_zones",
				dangerLevel: "low",
				parameters: [{ name: "namespace", in: "path", required: true, type: "string", default: "$XCSH_NAMESPACE" }],
			},
		],
	},
	"http-loadbalancer": {
		name: "http-loadbalancer",
		displayName: "HTTP Load Balancer",
		operations: [
			{
				name: "create_http_lb",
				operationId: "test.create_http_lb",
				description: "Create HTTP load balancer",
				method: "POST",
				path: "/api/config/namespaces/{namespace}/http_loadbalancers",
				dangerLevel: "high",
				parameters: [{ name: "namespace", in: "path", required: true, type: "string" }],
			},
		],
	},
};

function parseUrl(urlStr: string): InternalUrl {
	const url = new URL(urlStr) as InternalUrl;
	const match = urlStr.match(/^xcsh:\/\/([^/?#]+)(\/[^?#]*)?/);
	url.rawHost = match?.[1] ?? "";
	url.rawPathname = match?.[2] ?? "/";
	return url;
}

function specIndexForResource(resource: ApiSpecIndex["domains"][number]["resources"][number]): ApiSpecIndex {
	return {
		version: "test",
		timestamp: "2026-09-03T00:00:00Z",
		domains: [
			{
				domain: "dns",
				title: "DNS",
				description: "DNS resources",
				descriptionShort: "DNS",
				category: "networking",
				pathCount: 1,
				schemaCount: 1,
				complexity: "medium",
				resources: [resource],
			},
		],
	};
}

describe("API Catalog Resolver", () => {
	it("renders catalog index with all categories", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogData);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/"));
		expect(result.contentType).toBe("text/markdown");
		expect(result.content).toContain("dns-zone");
		expect(result.content).toContain("DNS Zone");
		expect(result.content).toContain("http-loadbalancer");
	});

	it("filters categories by search term", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogData);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/?search=dns"));
		expect(result.content).toContain("dns-zone");
		expect(result.content).not.toContain("http-loadbalancer");
	});

	it("search is case-insensitive", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogData);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/?search=DNS"));
		expect(result.content).toContain("dns-zone");
	});

	it("renders category detail with operations", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogData);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/dns-zone"));
		expect(result.content).toContain("POST");
		expect(result.content).toContain("/api/config/dns/namespaces/{namespace}/dns_zones");
		expect(result.content).toContain("Create a DNS zone");
		expect(result.content).toContain("medium");
	});

	it("does not render curl for operations (agent uses the xcsh_api tool)", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogData);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/dns-zone"));
		expect(result.content).not.toContain("curl");
		expect(result.content).not.toContain("Curl Example");
	});

	it("returns helpful error for unknown category", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogData);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/nonexistent"));
		expect(result.content).toContain("not found");
	});

	it("renders parameters in category detail", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogData);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/dns-zone"));
		expect(result.content).toContain("namespace");
		expect(result.content).toContain("$XCSH_NAMESPACE");
	});

	it("renders minimum payload when present", async () => {
		const cat: ApiCatalogCategory = {
			name: "test-resources",
			displayName: "Test Resources",
			operations: [
				{
					name: "create_test",
					operationId: "test.create_test",
					description: "Create a test",
					method: "POST",
					path: "/api/test/{namespace}/resources",
					dangerLevel: "medium",
					parameters: [],
					minimumPayload: {
						json: { metadata: { name: "example" }, spec: {} },
						requiredFields: ["metadata", "spec"],
						description: "Minimum config for test",
					},
				},
			],
		};
		const data = { "test-resources": cat };
		const summaries = [{ name: "test-resources", displayName: "Test Resources", operationCount: 1 }];
		const resolver = createApiCatalogResolver(testCatalogIndex, summaries, data);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/test-resources"));
		expect(result.content).toContain("### Minimum Configuration");
		expect(result.content).toContain('"name": "example"');
		expect(result.content).toContain("Required fields: metadata, spec");
	});

	it("renders field constraints table when fieldMetadata present", async () => {
		const cat: ApiCatalogCategory = {
			name: "test-resources",
			displayName: "Test Resources",
			operations: [
				{
					name: "create_test",
					operationId: "test.create_test",
					description: "Create",
					method: "POST",
					path: "/api/test",
					dangerLevel: "medium",
					parameters: [],
					fieldMetadata: {
						"metadata.name": {
							type: "string",
							description: "Resource name",
							constraints: { pattern: "^[a-z0-9][-a-z0-9]*$", maxLength: 64 },
							required_for: { minimum_config: true, create: true },
						},
					},
				},
			],
		};
		const data = { "test-resources": cat };
		const summaries = [{ name: "test-resources", displayName: "Test Resources", operationCount: 1 }];
		const resolver = createApiCatalogResolver(testCatalogIndex, summaries, data);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/test-resources"));
		expect(result.content).toContain("### Field Constraints");
		expect(result.content).toContain("metadata.name");
		expect(result.content).toContain("maxLength: 64");
	});

	it("renders ranges and metadata note in field constraints", async () => {
		const cat: ApiCatalogCategory = {
			name: "test-resources",
			displayName: "Test Resources",
			operations: [
				{
					name: "create_test",
					operationId: "test.create_test",
					description: "Create",
					method: "POST",
					path: "/api/test",
					dangerLevel: "medium",
					parameters: [],
					fieldMetadata: {
						"spec.jitter_percent": {
							type: "integer",
							description: "Jitter percentage",
							constraints: {
								ranges: [
									{ minimum: 0, maximum: 0 },
									{ minimum: 10, maximum: 50 },
								],
								metadata: {
									note: "Non-contiguous: {0} union [10, 50]",
								},
							},
						},
					},
				},
			],
		};
		const data = { "test-resources": cat };
		const summaries = [{ name: "test-resources", displayName: "Test Resources", operationCount: 1 }];
		const resolver = createApiCatalogResolver(testCatalogIndex, summaries, data);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/test-resources"));
		expect(result.content).toContain("ranges: {0} ∪ [10,50]");
		expect(result.content).toContain("note: Non-contiguous: {0} union [10, 50]");
	});

	it("renders oneOf recommendations table when present", async () => {
		const cat: ApiCatalogCategory = {
			name: "test-resources",
			displayName: "Test Resources",
			operations: [
				{
					name: "create_test",
					operationId: "test.create_test",
					description: "Create",
					method: "POST",
					path: "/api/test",
					dangerLevel: "medium",
					parameters: [],
					oneOfRecommendations: {
						"spec.health_check": "http_health_check",
						"spec.tls_choice": "no_tls",
					},
				},
			],
		};
		const data = { "test-resources": cat };
		const summaries = [{ name: "test-resources", displayName: "Test Resources", operationCount: 1 }];
		const resolver = createApiCatalogResolver(testCatalogIndex, summaries, data);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/test-resources"));
		expect(result.content).toContain("### OneOf Groups");
		expect(result.content).toContain("http_health_check");
	});

	it("renders response summary when present", async () => {
		const cat: ApiCatalogCategory = {
			name: "test-resources",
			displayName: "Test Resources",
			operations: [
				{
					name: "create_test",
					operationId: "test.create_test",
					description: "Create",
					method: "POST",
					path: "/api/test",
					dangerLevel: "medium",
					parameters: [],
					responseSummary: [
						{ field: "metadata", type: "object", description: "Resource identity" },
						{ field: "spec", type: "object", description: "Resource spec" },
					],
				},
			],
		};
		const data = { "test-resources": cat };
		const summaries = [{ name: "test-resources", displayName: "Test Resources", operationCount: 1 }];
		const resolver = createApiCatalogResolver(testCatalogIndex, summaries, data);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/test-resources"));
		expect(result.content).toContain("### Response");
		expect(result.content).toContain("Resource identity");
	});

	it("operations without enrichment render identically to before", async () => {
		const resolver = createApiCatalogResolver(testCatalogIndex, testCategorySummaries, testCatalogData);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/dns-zone"));
		expect(result.content).not.toContain("### Minimum Configuration");
		expect(result.content).not.toContain("### Field Constraints");
		expect(result.content).not.toContain("### OneOf Groups");
		expect(result.content).not.toContain("Curl Example");
	});

	it("deduplicates field constraints for POST/PUT with differing provenance timestamps", async () => {
		const postMeta = {
			"metadata.name": {
				type: "string",
				description: "Resource name",
				constraints: {
					maxLength: 64,
					metadata: { source: "discovery", confidence: 0.99, validatedAt: "2026-01-01T00:00:00.001Z" },
				},
			},
		};
		const putMeta = {
			"metadata.name": {
				type: "string",
				description: "Resource name",
				constraints: {
					maxLength: 64,
					metadata: { source: "discovery", confidence: 0.99, validatedAt: "2026-01-01T00:00:00.002Z" },
				},
			},
		};
		const cat: ApiCatalogCategory = {
			name: "test-resources",
			displayName: "Test Resources",
			operations: [
				{
					name: "create_test",
					operationId: "test.create_test",
					description: "Create",
					method: "POST",
					path: "/api/test/{namespace}/resources",
					dangerLevel: "medium",
					parameters: [],
					fieldMetadata: postMeta,
				},
				{
					name: "replace_test",
					operationId: "test.replace_test",
					description: "Replace",
					method: "PUT",
					path: "/api/test/{namespace}/resources/{name}",
					dangerLevel: "medium",
					parameters: [],
					fieldMetadata: putMeta,
				},
			],
		};
		const data = { "test-resources": cat };
		const summaries = [{ name: "test-resources", displayName: "Test Resources", operationCount: 2 }];
		const resolver = createApiCatalogResolver(testCatalogIndex, summaries, data);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/test-resources"));
		const postIndex = result.content.indexOf("## POST");
		const putIndex = result.content.indexOf("## PUT");
		const postConstraints = result.content.indexOf("| metadata.name |");
		const putBackRef = result.content.indexOf("Same as POST");
		expect(postIndex).toBeGreaterThan(-1);
		expect(putIndex).toBeGreaterThan(-1);
		expect(postConstraints).toBeGreaterThan(postIndex);
		expect(postConstraints).toBeLessThan(putIndex);
		expect(putBackRef).toBeGreaterThan(putIndex);
	});

	it("renders both constraint tables when POST/PUT metadata differs", async () => {
		const cat: ApiCatalogCategory = {
			name: "test-resources",
			displayName: "Test Resources",
			operations: [
				{
					name: "create_test",
					operationId: "test.create_test",
					description: "Create",
					method: "POST",
					path: "/api/test/{namespace}/resources",
					dangerLevel: "medium",
					parameters: [],
					fieldMetadata: {
						"metadata.name": { type: "string", constraints: { maxLength: 64 } },
					},
				},
				{
					name: "replace_test",
					operationId: "test.replace_test",
					description: "Replace",
					method: "PUT",
					path: "/api/test/{namespace}/resources/{name}",
					dangerLevel: "medium",
					parameters: [],
					fieldMetadata: {
						"metadata.name": { type: "string", constraints: { maxLength: 64 } },
						"spec.extra_field": { type: "string", constraints: { maxLength: 128 } },
					},
				},
			],
		};
		const data = { "test-resources": cat };
		const summaries = [{ name: "test-resources", displayName: "Test Resources", operationCount: 2 }];
		const resolver = createApiCatalogResolver(testCatalogIndex, summaries, data);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/test-resources"));
		expect(result.content).not.toContain("Same as POST");
		const constraintMatches = result.content.match(/### Field Constraints/g);
		expect(constraintMatches?.length).toBe(2);
	});

	it("compact mode omits field constraints but keeps other sections", async () => {
		const cat: ApiCatalogCategory = {
			name: "test-resources",
			displayName: "Test Resources",
			operations: [
				{
					name: "create_test",
					operationId: "test.create_test",
					description: "Create",
					method: "POST",
					path: "/api/test",
					dangerLevel: "medium",
					parameters: [],
					minimumPayload: {
						json: { metadata: { name: "example" } },
						requiredFields: ["metadata"],
						description: "Minimum config",
					},
					fieldMetadata: {
						"metadata.name": {
							type: "string",
							constraints: { maxLength: 64 },
						},
					},
					oneOfRecommendations: { "spec.tls_choice": "no_tls" },
				},
			],
		};
		const data = { "test-resources": cat };
		const summaries = [{ name: "test-resources", displayName: "Test Resources", operationCount: 1 }];
		const resolver = createApiCatalogResolver(testCatalogIndex, summaries, data);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/test-resources?compact=true"));
		expect(result.content).toContain("### Minimum Configuration");
		expect(result.content).not.toContain("Curl Example");
		expect(result.content).toContain("### OneOf Groups");
		expect(result.content).not.toContain("### Field Constraints");
	});

	it("non-compact mode still renders field constraints", async () => {
		const cat: ApiCatalogCategory = {
			name: "test-resources",
			displayName: "Test Resources",
			operations: [
				{
					name: "create_test",
					operationId: "test.create_test",
					description: "Create",
					method: "POST",
					path: "/api/test",
					dangerLevel: "medium",
					parameters: [],
					fieldMetadata: {
						"metadata.name": {
							type: "string",
							constraints: { maxLength: 64 },
						},
					},
				},
			],
		};
		const data = { "test-resources": cat };
		const summaries = [{ name: "test-resources", displayName: "Test Resources", operationCount: 1 }];
		const resolver = createApiCatalogResolver(testCatalogIndex, summaries, data);
		const result = await resolver.resolve(parseUrl("xcsh://api-catalog/test-resources"));
		expect(result.content).toContain("### Field Constraints");
		expect(result.content).toContain("metadata.name");
	});

	it("selects canonical CRUD deterministically when category order is reversed", async () => {
		const canonicalPath = "/api/config/dns/namespaces/{namespace}/dns_zones";
		const data: Record<string, ApiCatalogCategory> = {
			ancillary: {
				name: "ancillary",
				displayName: "DNS health",
				operations: [
					{
						name: "get_health",
						operationId: "ves.io.schema.dns_zone.CustomAPI.Health",
						description: "Health status",
						method: "GET",
						path: "/api/data/dns_zones/health",
						dangerLevel: "low",
						parameters: [],
					},
				],
			},
			canonical: {
				name: "canonical",
				displayName: "DNS zones",
				operations: [
					{
						name: "create_dns_zone",
						operationId: "ves.io.schema.dns_zone.API.Create",
						description: "Canonical create",
						method: "POST",
						path: canonicalPath,
						dangerLevel: "medium",
						parameters: [],
					},
				],
			},
		};
		const specIndex = specIndexForResource({
			name: "dns_zone",
			description: "Authoritative DNS zone",
			apiPaths: [canonicalPath, "/api/data/dns_zones/health"],
			catalogCategories: ["ancillary", "canonical"],
			canonicalCrudOperations: [
				{ method: "POST", path: canonicalPath, operationId: "ves.io.schema.dns_zone.API.Create" },
			],
		});
		const summaries = Object.values(data).map(category => ({
			name: category.name,
			displayName: category.displayName,
			operationCount: category.operations.length,
		}));
		const result = await createApiCatalogResolver(testCatalogIndex, summaries, data, specIndex).resolve(
			parseUrl("xcsh://api-catalog/?resource=dns_zone"),
		);
		expect(result.content).toContain("Canonical create");
		expect(result.content).not.toContain("Health status");
	});

	it("renders ancillary links and authoritative fallback when expected CRUD is absent", async () => {
		const specIndex = specIndexForResource({
			name: "dns_zone",
			description: "Authoritative DNS zone",
			apiPaths: ["/api/data/dns_zones/health"],
			catalogCategories: ["dns-zone"],
			canonicalCrudOperations: [
				{
					method: "POST",
					path: "/api/config/dns/namespaces/{namespace}/dns_zones",
					operationId: "ves.io.schema.dns_zone.API.Create",
				},
			],
		});
		const result = await createApiCatalogResolver(
			testCatalogIndex,
			testCategorySummaries,
			testCatalogData,
			specIndex,
		).resolve(parseUrl("xcsh://api-catalog/?resource=dns_zone"));
		expect(result.content).toContain("Canonical CRUD unavailable");
		expect(result.content).toContain("xcsh://api-catalog/dns-zone");
		expect(result.content).toContain("xcsh://api-spec/dns?resource=dns_zone&crud=true");
	});

	it("selects the best path-covered category for a custom-only resource", async () => {
		const collectionOperation = testCatalogData["dns-zone"].operations[0];
		const actionOperation = {
			...testCatalogData["dns-zone"].operations[1],
			path: "/api/config/dns/namespaces/{namespace}/dns_zones/{name}/export",
		};
		const data: Record<string, ApiCatalogCategory> = {
			partial: {
				name: "partial",
				displayName: "Partial",
				operations: [collectionOperation],
			},
			complete: {
				name: "complete",
				displayName: "Complete",
				operations: [collectionOperation, actionOperation],
			},
		};
		const specIndex = specIndexForResource({
			name: "custom_dns",
			description: "Custom DNS actions",
			apiPaths: [collectionOperation.path, actionOperation.path],
			catalogCategories: ["partial", "complete"],
			canonicalCrudOperations: [],
		});
		const summaries = Object.values(data).map(category => ({
			name: category.name,
			displayName: category.displayName,
			operationCount: category.operations.length,
		}));
		const result = await createApiCatalogResolver(testCatalogIndex, summaries, data, specIndex).resolve(
			parseUrl("xcsh://api-catalog/?resource=custom_dns"),
		);
		expect(result.content).toContain("# Complete");
		expect(result.content).toContain("List DNS zones");
	});

	it("searches resource metadata and labels canonical results before ancillary results", async () => {
		const canonicalPath = "/api/config/dns/namespaces/{namespace}/dns_zones";
		const specIndex = specIndexForResource({
			name: "dns_zone",
			description: "Authoritative DNS zone",
			apiPaths: [canonicalPath, "/api/data/dns_zones/health"],
			catalogCategories: ["dns-zone", "http-loadbalancer"],
			canonicalCrudOperations: [{ method: "POST", path: canonicalPath, operationId: "test.create_dns_zone" }],
		});
		const result = await createApiCatalogResolver(
			testCatalogIndex,
			testCategorySummaries,
			testCatalogData,
			specIndex,
		).resolve(parseUrl("xcsh://api-catalog/?search=authoritative"));
		expect(result.content).toContain("canonical CRUD");
		expect(result.content).toContain("ancillary");
		expect(result.content.indexOf("dns-zone")).toBeLessThan(result.content.indexOf("http-loadbalancer"));
	});

	it("renders non-executable minimum-payload diagnostics", async () => {
		const diagnostic: ApiCatalogCategory = {
			name: "diagnostic",
			displayName: "Diagnostic",
			operations: [
				{
					name: "create_diagnostic",
					operationId: "test.create_diagnostic",
					description: "Create",
					method: "POST",
					path: "/api/test",
					dangerLevel: "medium",
					parameters: [],
					minimumPayloadDiagnostic: {
						reasonCode: "unresolved-oneof",
						message: "No concrete request variant is available.",
					},
				},
			],
		};
		const result = await createApiCatalogResolver(
			testCatalogIndex,
			[{ name: "diagnostic", displayName: "Diagnostic", operationCount: 1 }],
			{ diagnostic },
		).resolve(parseUrl("xcsh://api-catalog/diagnostic"));
		expect(result.content).toContain("Minimum Configuration Unavailable");
		expect(result.content).toContain("unresolved-oneof");
		expect(result.content).not.toContain("```json");
	});
});
