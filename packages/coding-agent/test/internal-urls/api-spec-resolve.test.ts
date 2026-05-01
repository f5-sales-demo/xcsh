import { describe, expect, it } from "bun:test";
import { gzipSync } from "node:zlib";
import { createApiSpecResolver } from "../../src/internal-urls/api-spec-resolve";
import type { ApiSpecIndex, OpenAPISpec } from "../../src/internal-urls/api-spec-types";
import type { InternalUrl } from "../../src/internal-urls/types";

function makeSpec(overrides: Partial<OpenAPISpec> = {}): OpenAPISpec {
	return {
		info: { title: "Test Domain", version: "1.0.0" },
		paths: {
			"/api/config/dns/namespaces/{ns}/dns_zones": {
				post: {
					summary: "Create DNS zone",
					operationId: "ves.io.schema.dns_zone.API.Create",
					parameters: [{ name: "ns", in: "path", required: true, schema: { type: "string" } }],
					requestBody: {
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										metadata: {
											type: "object",
											properties: {
												name: { type: "string", description: "Zone name" },
												namespace: { type: "string", description: "Target namespace" },
											},
											required: ["name"],
										},
										spec: {
											type: "object",
											properties: {
												dns_type: { type: "string", description: "primary or secondary" },
											},
										},
									},
								},
							},
						},
					},
					responses: {
						"200": {
							description: "Success",
							content: {
								"application/json": {
									schema: {
										type: "object",
										properties: {
											metadata: { type: "object" },
											spec: { type: "object" },
										},
									},
								},
							},
						},
					},
				},
				get: {
					summary: "List DNS zones",
					operationId: "ves.io.schema.dns_zone.API.List",
				},
			},
			"/api/config/dns/namespaces/{ns}/dns_zones/{name}": {
				get: {
					summary: "Get DNS zone",
					operationId: "ves.io.schema.dns_zone.API.Get",
					parameters: [
						{ name: "ns", in: "path", required: true, schema: { type: "string" } },
						{ name: "name", in: "path", required: true, schema: { type: "string" } },
					],
				},
				delete: {
					summary: "Delete DNS zone",
					operationId: "ves.io.schema.dns_zone.API.Delete",
				},
			},
			"/api/config/dns/namespaces/{ns}/dns_records": {
				get: {
					summary: "List DNS records",
					operationId: "ves.io.schema.dns_record.API.List",
				},
			},
		},
		components: {
			schemas: {
				DnsZone: {
					type: "object",
					properties: {
						metadata: { type: "object" },
						spec: { type: "object" },
					},
				},
			},
		},
		...overrides,
	};
}

function compressSpec(spec: OpenAPISpec): string {
	return gzipSync(Buffer.from(JSON.stringify(spec))).toString("base64");
}

const testIndex: ApiSpecIndex = {
	version: "1.0.0",
	timestamp: "2026-04-30T00:00:00Z",
	domains: [
		{
			domain: "dns",
			title: "DNS",
			description: "DNS zone and record management",
			descriptionShort: "DNS management",
			category: "Networking",
			pathCount: 5,
			schemaCount: 3,
			complexity: "standard",
			resources: [
				{ name: "dns_zone", description: "Primary DNS zone management" },
				{ name: "dns_record", description: "Individual DNS records" },
			],
			useCases: ["Manage DNS zones", "Configure records"],
			relatedDomains: ["cdn"],
		},
		{
			domain: "cdn",
			title: "CDN",
			description: "Content delivery network configuration",
			descriptionShort: "CDN config",
			category: "Networking",
			pathCount: 3,
			schemaCount: 2,
			complexity: "simple",
			resources: [{ name: "cdn_distribution", description: "CDN distributions" }],
		},
	],
};

const testBlobs: Record<string, string> = {
	dns: compressSpec(makeSpec()),
	cdn: compressSpec(makeSpec({ info: { title: "CDN Domain", version: "1.0.0" }, paths: {} })),
};

function parseUrl(urlStr: string): InternalUrl {
	const url = new URL(urlStr) as InternalUrl;
	const match = urlStr.match(/^xcsh:\/\/([^/?#]+)(\/[^?#]*)?/);
	url.rawHost = match?.[1] ?? "";
	url.rawPathname = match?.[2] ?? "/";
	return url;
}

describe("API Spec Resolver", () => {
	describe("Level 1 — Domain Index", () => {
		it("returns markdown content type", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.contentType).toBe("text/markdown");
		});

		it("lists all domains", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.content).toContain("dns");
			expect(result.content).toContain("cdn");
		});

		it("contains version string", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.content).toContain("1.0.0");
		});

		it("contains domain count", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.content).toContain("2");
		});

		it("contains table headers", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.content).toContain("Domain");
			expect(result.content).toContain("Category");
			expect(result.content).toContain("Description");
		});
	});

	describe("Level 2 — Domain Detail", () => {
		it("returns domain title and category", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("DNS");
			expect(result.content).toContain("Networking");
		});

		it("contains resource table", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("dns_zone");
			expect(result.content).toContain("dns_record");
		});

		it("contains operations from spec paths", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("POST");
			expect(result.content).toContain("Create DNS zone");
			expect(result.content).toContain("/api/config/dns/namespaces/{ns}/dns_zones");
		});

		it("contains use cases", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("Manage DNS zones");
		});

		it("contains related domains", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("cdn");
		});

		it("contains next-step URL guidance", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("xcsh://api-spec/dns?resource=");
		});
	});

	describe("Level 3 — Resource filter", () => {
		it("filters paths by resource name", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("Create DNS zone");
			expect(result.content).toContain("Get DNS zone");
			expect(result.content).toContain("Delete DNS zone");
			expect(result.content).not.toContain("List DNS records");
		});

		it("renders parameters for filtered paths", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("ns");
			expect(result.content).toContain("path");
		});

		it("renders request body schema", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("metadata");
			expect(result.content).toContain("Zone name");
		});

		it("returns helpful error for unknown resource", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=nonexistent"));
			expect(result.content).toContain("Resource not found");
			expect(result.content).toContain("dns_zone");
		});
	});

	describe("Error cases", () => {
		it("suggests alternatives for unknown domain", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dms"));
			expect(result.content).toContain("dns");
		});

		it("lists all domains when domain not found", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/nonexistent"));
			expect(result.content).toContain("dns");
			expect(result.content).toContain("cdn");
		});
	});

	describe("Decompression", () => {
		it("decompresses and parses spec correctly", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("Create DNS zone");
		});

		it("caches decompressed specs across calls", async () => {
			const resolver = createApiSpecResolver(testIndex, testBlobs);
			const r1 = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			const r2 = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(r1.content).toBe(r2.content);
		});
	});

	describe("CustomAPI operationId matching", () => {
		it("matches paths with CustomAPI operationIds", async () => {
			const specWithCustomApi = makeSpec({
				paths: {
					"/api/config/dns/namespaces/{ns}/dns_zones/verify": {
						post: {
							summary: "Verify DNS zone",
							operationId: "ves.io.schema.dns_zone.CustomAPI.Verify",
						},
					},
					"/api/config/dns/namespaces/{ns}/dns_zones": {
						get: {
							summary: "List DNS zones",
							operationId: "ves.io.schema.dns_zone.API.List",
						},
					},
				},
			});
			const blobs = { dns: compressSpec(specWithCustomApi) };
			const resolver = createApiSpecResolver(testIndex, blobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("Verify DNS zone");
			expect(result.content).toContain("List DNS zones");
		});

		it("matches dotted schema components", async () => {
			const specWithDottedSchema = makeSpec({
				paths: {
					"/api/config/network/namespaces/{ns}/forward_proxy_policies": {
						get: {
							summary: "List forward proxy policies",
							operationId: "ves.io.schema.views.forward_proxy_policy.API.List",
						},
					},
				},
			});
			const blobs = { dns: compressSpec(specWithDottedSchema) };
			const resolver = createApiSpecResolver(testIndex, blobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=views.forward_proxy_policy"));
			expect(result.content).toContain("List forward proxy policies");
		});
	});

	describe("Schema resolution", () => {
		it("resolves $ref pointers", async () => {
			const specWithRef = makeSpec({
				paths: {
					"/api/test": {
						post: {
							summary: "Test",
							requestBody: {
								content: {
									"application/json": {
										schema: { $ref: "#/components/schemas/DnsZone" },
									},
								},
							},
							responses: {},
						},
					},
				},
			});
			const blobs = { dns: compressSpec(specWithRef) };
			const resolver = createApiSpecResolver(testIndex, blobs);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=test"));
			expect(result.contentType).toBe("text/markdown");
		});
	});
});
