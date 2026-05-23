import { describe, expect, it } from "bun:test";
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

const testIndex: ApiSpecIndex = {
	version: "1.0.0",
	timestamp: "2026-04-30T00:00:00Z",
	criticalResources: ["dns_zone", "http_loadbalancer"],
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
			icon: "🌐",
			requiresTier: "Standard",
			resources: [
				{
					name: "dns_zone",
					description: "Primary DNS zone management",
					schemaComponents: ["dns_zone"],
					apiPaths: [
						"/api/config/dns/namespaces/{ns}/dns_zones",
						"/api/config/dns/namespaces/{ns}/dns_zones/{name}",
					],
					tier: "Standard",
					supportsLogs: true,
					supportsMetrics: true,
					dependencies: { required: [], optional: ["dns_load_balancer"] },
					relationshipHints: ["dns_load_balancer: Geographic or weighted DNS routing"],
				},
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
	guidedWorkflows: {
		version: "1.0.0",
		total_workflows: 1,
		domains: ["cdn"],
		workflows: [
			{
				id: "enable_cdn",
				name: "Enable CDN Distribution",
				description: "Configure CDN",
				complexity: "medium",
				estimated_steps: 3,
				prerequisites: ["Existing origin server"],
				domain: "cdn",
				steps: [
					{
						order: 1,
						action: "create_origin",
						name: "Define Origin",
						description: "Configure origin",
						resource: "cdn_origin",
						required_fields: ["name"],
					},
					{
						order: 2,
						action: "create_dist",
						name: "Create Distribution",
						description: "Create CDN dist",
						depends_on: [1],
					},
				],
			},
		],
	},
	errorResolution: {
		version: "1.0.0",
		http_errors: {
			"401": {
				code: 401,
				name: "Unauthorized",
				description: "Authentication credentials missing or invalid",
				common_causes: ["Missing Authorization header", "Expired token"],
				diagnostic_steps: [{ step: 1, action: "Check header", description: "Verify Authorization header" }],
				prevention: ["Rotate tokens regularly"],
			},
		},
		resource_errors: {
			dns_zone: [{ error_code: 409, pattern: "zone exists", resolution: "Use existing zone or delete first" }],
		},
	},
	acronyms: {
		version: "1.0.0",
		categories: ["Networking"],
		acronyms: [
			{ acronym: "DNS", expansion: "Domain Name System", category: "Networking" },
			{ acronym: "CDN", expansion: "Content Delivery Network", category: "Networking" },
		],
	},
};

const testData: Record<string, OpenAPISpec> = {
	dns: makeSpec(),
	cdn: makeSpec({ info: { title: "CDN Domain", version: "1.0.0" }, paths: {} }),
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
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.contentType).toBe("text/markdown");
		});

		it("lists all domains", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.content).toContain("dns");
			expect(result.content).toContain("cdn");
		});

		it("contains version string", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.content).toContain("1.0.0");
		});

		it("contains domain count", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.content).toContain("2");
		});

		it("contains table headers", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.content).toContain("Domain");
			expect(result.content).toContain("Category");
			expect(result.content).toContain("Description");
		});

		it("contains icon column", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.content).toContain("Icon");
			expect(result.content).toContain("🌐");
		});

		it("contains tier column", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.content).toContain("Tier");
			expect(result.content).toContain("Standard");
		});

		it("marks domains with critical resources", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/"));
			expect(result.content).toContain("DNS management *");
			expect(result.content).toContain("critical resources");
		});
	});

	describe("Level 2 — Domain Detail", () => {
		it("returns domain title and category", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("DNS");
			expect(result.content).toContain("Networking");
		});

		it("contains resource table", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("dns_zone");
			expect(result.content).toContain("dns_record");
		});

		it("contains operations from spec paths", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("POST");
			expect(result.content).toContain("Create DNS zone");
			expect(result.content).toContain("/api/config/dns/namespaces/{ns}/dns_zones");
		});

		it("contains use cases", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("Manage DNS zones");
		});

		it("contains related domains", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("cdn");
		});

		it("contains next-step URL guidance", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("xcsh://api-spec/dns?resource=");
		});

		it("shows tier/preview banner for advanced domains", async () => {
			const advancedIndex: ApiSpecIndex = {
				...testIndex,
				domains: [{ ...testIndex.domains[0], requiresTier: "Advanced", isPreview: true }, testIndex.domains[1]],
			};
			const resolver = createApiSpecResolver(advancedIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("Advanced");
			expect(result.content).toContain("Preview");
		});

		it("shows dependency information", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("dns_load_balancer");
		});

		it("shows relationship hints", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("Geographic or weighted DNS routing");
		});

		it("shows observability flags", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("logs");
			expect(result.content).toContain("metrics");
		});

		it("renders best practices when present", async () => {
			const indexWithBp: ApiSpecIndex = {
				...testIndex,
				domains: [
					{
						...testIndex.domains[0],
						bestPractices: {
							commonErrors: [
								{
									code: 409,
									message: "Zone exists",
									resolution: "Delete first",
									prevention: "Check before creating",
								},
							],
							securityNotes: ["Always use HTTPS"],
							performanceTips: ["Use batch operations"],
						},
					},
					testIndex.domains[1],
				],
			};
			const resolver = createApiSpecResolver(indexWithBp, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("Best Practices");
			expect(result.content).toContain("Zone exists");
			expect(result.content).toContain("Delete first");
			expect(result.content).toContain("Always use HTTPS");
			expect(result.content).toContain("Use batch operations");
		});

		it("renders CLI metadata when present", async () => {
			const indexWithCli: ApiSpecIndex = {
				...testIndex,
				domains: [
					{
						...testIndex.domains[0],
						cliMetadata: {
							quickStart: {
								command: "vesctl dns list",
								description: "List all zones",
								expectedOutput: "zone list",
							},
							commonWorkflows: [{ name: "Create zone", commands: ["vesctl dns create --name test"] }],
							troubleshooting: [{ symptom: "Zone not found", fix: "Check namespace" }],
						},
					},
					testIndex.domains[1],
				],
			};
			const resolver = createApiSpecResolver(indexWithCli, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("CLI Quick Start");
			expect(result.content).toContain("vesctl dns list");
			expect(result.content).toContain("Create zone");
		});

		it("uses descriptionLong when available", async () => {
			const indexWithLong: ApiSpecIndex = {
				...testIndex,
				domains: [
					{
						...testIndex.domains[0],
						descriptionLong: "This is a very detailed long description of the DNS domain.",
					},
					testIndex.domains[1],
				],
			};
			const resolver = createApiSpecResolver(indexWithLong, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("very detailed long description");
		});
	});

	describe("Level 3 — Resource filter", () => {
		it("filters paths by resource name", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("Create DNS zone");
			expect(result.content).toContain("Get DNS zone");
			expect(result.content).toContain("Delete DNS zone");
			expect(result.content).not.toContain("List DNS records");
		});

		it("renders parameters for filtered paths", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("ns");
			expect(result.content).toContain("path");
		});

		it("renders request body schema", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("metadata");
			expect(result.content).toContain("Zone name");
		});

		it("returns helpful error for unknown resource", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=nonexistent"));
			expect(result.content).toContain("Resource not found");
			expect(result.content).toContain("dns_zone");
		});

		it("prefers apiPaths over schemaComponents when both are present", async () => {
			const specWithExtra = makeSpec({
				paths: {
					"/api/config/dns/namespaces/{ns}/dns_zones": {
						post: { summary: "Create DNS zone", operationId: "ves.io.schema.dns_zone.API.Create" },
					},
					"/api/config/dns/namespaces/{ns}/dns_zones/{name}": {
						get: { summary: "Get DNS zone", operationId: "ves.io.schema.dns_zone.API.Get" },
					},
					"/api/extra/dns_zone_stats": {
						get: {
							summary: "Stats (should be excluded)",
							operationId: "ves.io.schema.dns_zone.CustomAPI.Stats",
						},
					},
				},
			});
			const indexWithApiPaths: ApiSpecIndex = {
				...testIndex,
				domains: [
					{
						...testIndex.domains[0],
						resources: [
							{
								name: "dns_zone",
								description: "DNS zone",
								schemaComponents: ["dns_zone"],
								apiPaths: [
									"/api/config/dns/namespaces/{ns}/dns_zones",
									"/api/config/dns/namespaces/{ns}/dns_zones/{name}",
								],
							},
						],
					},
					testIndex.domains[1],
				],
			};
			const data = { dns: specWithExtra, cdn: testData.cdn };
			const resolver = createApiSpecResolver(indexWithApiPaths, data);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("Create DNS zone");
			expect(result.content).toContain("Get DNS zone");
			expect(result.content).not.toContain("Stats (should be excluded)");
		});
	});

	describe("Error cases", () => {
		it("suggests alternatives for unknown domain", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dms"));
			expect(result.content).toContain("dns");
		});

		it("lists all domains when domain not found", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/nonexistent"));
			expect(result.content).toContain("dns");
			expect(result.content).toContain("cdn");
		});
	});

	describe("Data lookup", () => {
		it("looks up and returns spec data correctly", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("Create DNS zone");
		});

		it("returns error for missing domain data", async () => {
			const resolver = createApiSpecResolver(testIndex, {});
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns"));
			expect(result.content).toContain("Error loading dns");
			expect(result.content).toContain("No spec data for domain: dns");
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
			const indexNoApiPaths: ApiSpecIndex = {
				...testIndex,
				domains: [
					{
						...testIndex.domains[0],
						resources: [
							{ name: "dns_zone", description: "DNS zone" },
							{ name: "dns_record", description: "DNS records" },
						],
					},
					testIndex.domains[1],
				],
			};
			const data = { dns: specWithCustomApi };
			const resolver = createApiSpecResolver(indexNoApiPaths, data);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("Verify DNS zone");
			expect(result.content).toContain("List DNS zones");
		});

		it("matches dotted schema components", async () => {
			const indexNoApiPaths: ApiSpecIndex = {
				...testIndex,
				domains: [
					{
						...testIndex.domains[0],
						resources: [
							{ name: "dns_zone", description: "DNS zone" },
							{ name: "dns_record", description: "DNS records" },
						],
					},
					testIndex.domains[1],
				],
			};
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
			const data = { dns: specWithDottedSchema };
			const resolver = createApiSpecResolver(indexNoApiPaths, data);
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
			const data = { dns: specWithRef };
			const resolver = createApiSpecResolver(testIndex, data);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=test"));
			expect(result.contentType).toBe("text/markdown");
			expect(result.content).toContain("metadata");
			expect(result.content).toContain("spec");
		});

		it("resolves allOf-wrapped $ref pointers", async () => {
			const specWithAllOfRef = makeSpec({
				paths: {
					"/api/test": {
						post: {
							summary: "Test allOf",
							requestBody: {
								content: {
									"application/json": {
										schema: {
											allOf: [{ $ref: "#/components/schemas/DnsZone" }],
											"x-f5xc-required": true,
										},
									},
								},
							},
							responses: {},
						},
					},
				},
			});
			const data = { dns: specWithAllOfRef };
			const resolver = createApiSpecResolver(testIndex, data);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=test"));
			expect(result.content).toContain("metadata");
			expect(result.content).toContain("spec");
		});

		it("returns schema unchanged when no $ref and no allOf", async () => {
			const specInline = makeSpec({
				paths: {
					"/api/test": {
						post: {
							summary: "Test inline",
							requestBody: {
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												inlineField: { type: "string", description: "Inline field" },
											},
										},
									},
								},
							},
							responses: {},
						},
					},
				},
			});
			const data = { dns: specInline };
			const resolver = createApiSpecResolver(testIndex, data);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=test"));
			expect(result.content).toContain("inlineField");
			expect(result.content).toContain("Inline field");
		});
	});

	describe("Reserved sub-paths", () => {
		it("renders workflow index", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/workflows/"));
			expect(result.content).toContain("enable_cdn");
			expect(result.content).toContain("Enable CDN Distribution");
			expect(result.content).toContain("medium");
		});

		it("renders workflow detail", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/workflows/enable_cdn"));
			expect(result.content).toContain("Define Origin");
			expect(result.content).toContain("cdn_origin");
			expect(result.content).toContain("Existing origin server");
		});

		it("renders error index", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/errors/"));
			expect(result.content).toContain("401");
			expect(result.content).toContain("Unauthorized");
			expect(result.content).toContain("dns_zone");
		});

		it("renders HTTP error detail", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/errors/401"));
			expect(result.content).toContain("Missing Authorization header");
			expect(result.content).toContain("Rotate tokens regularly");
		});

		it("renders resource error detail", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/errors/dns_zone"));
			expect(result.content).toContain("zone exists");
			expect(result.content).toContain("Use existing zone or delete first");
		});

		it("renders glossary", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/glossary/"));
			expect(result.content).toContain("DNS");
			expect(result.content).toContain("Domain Name System");
			expect(result.content).toContain("Networking");
		});

		it("does not confuse reserved sub-paths with domain names", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const wf = await resolver.resolve(parseUrl("xcsh://api-spec/workflows/"));
			expect(wf.content).not.toContain("Domain not found");
			const err = await resolver.resolve(parseUrl("xcsh://api-spec/errors/"));
			expect(err.content).not.toContain("Domain not found");
			const gl = await resolver.resolve(parseUrl("xcsh://api-spec/glossary/"));
			expect(gl.content).not.toContain("Domain not found");
		});
	});

	describe("Operation enrichments", () => {
		const enrichments = {
			dns: {
				operationMeta: {
					"ves.io.schema.dns_zone.API.Create": {
						dangerLevel: "medium" as const,
						confirmationRequired: false,
						sideEffects: { creates: ["dns_zone"] },
						discoveredResponseTime: { p50Ms: 200, p95Ms: 800, p99Ms: 2000, sampleCount: 50, source: "measured" },
						requiredFields: ["metadata.name", "metadata.namespace"],
						operationMetadata: {
							purpose: "Create a new DNS zone",
							prerequisites: ["Valid namespace must exist"],
							commonErrors: [{ code: 409, message: "Zone already exists", resolution: "Use a different name" }],
						},
					},
					"ves.io.schema.dns_zone.API.Delete": {
						dangerLevel: "high" as const,
						confirmationRequired: true,
						sideEffects: { deletes: ["dns_zone", "dns_records"] },
					},
				},
				schemaEnrichments: {},
			},
		};

		it("renders danger level for operations", async () => {
			const resolver = createApiSpecResolver(testIndex, testData, enrichments);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("medium");
			expect(result.content).toContain("high");
		});

		it("renders confirmation warning for dangerous operations", async () => {
			const resolver = createApiSpecResolver(testIndex, testData, enrichments);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("Confirmation required");
		});

		it("renders side effects", async () => {
			const resolver = createApiSpecResolver(testIndex, testData, enrichments);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("Creates: dns_zone");
			expect(result.content).toContain("Deletes: dns_zone, dns_records");
		});

		it("renders response time estimates", async () => {
			const resolver = createApiSpecResolver(testIndex, testData, enrichments);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("p50=200ms");
		});

		it("renders operation prerequisites and common errors", async () => {
			const resolver = createApiSpecResolver(testIndex, testData, enrichments);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("Valid namespace must exist");
			expect(result.content).toContain("Zone already exists");
		});
	});

	describe("Field-level enrichments", () => {
		it("renders server defaults and recommended values", async () => {
			const specWithFieldEnrichments = makeSpec({
				paths: {
					"/api/test": {
						post: {
							summary: "Test fields",
							requestBody: {
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												port: {
													type: "integer",
													description: "Port number",
													"x-f5xc-server-default": 443,
													"x-f5xc-recommended-value": 443,
												},
											},
										},
									},
								},
							},
							responses: {},
						},
					},
				},
			});
			const data = { dns: specWithFieldEnrichments };
			const resolver = createApiSpecResolver(testIndex, data);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=test"));
			expect(result.content).toContain("443");
			expect(result.content).toContain("Default");
		});

		it("renders required-for context", async () => {
			const specWithReqFor = makeSpec({
				paths: {
					"/api/test": {
						post: {
							summary: "Test required-for",
							requestBody: {
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												name: {
													type: "string",
													description: "Resource name",
													"x-f5xc-required-for": {
														minimum_config: true,
														create: true,
														update: false,
														read: false,
													},
												},
											},
										},
									},
								},
							},
							responses: {},
						},
					},
				},
			});
			const data = { dns: specWithReqFor };
			const resolver = createApiSpecResolver(testIndex, data);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=test"));
			expect(result.content).toContain("create");
		});

		it("renders conflicts-with warnings", async () => {
			const specWithConflicts = makeSpec({
				paths: {
					"/api/test": {
						post: {
							summary: "Test conflicts",
							requestBody: {
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												positive: {
													type: "string",
													description: "Positive feedback",
													"x-f5xc-conflicts-with": ["negative"],
												},
											},
										},
									},
								},
							},
							responses: {},
						},
					},
				},
			});
			const data = { dns: specWithConflicts };
			const resolver = createApiSpecResolver(testIndex, data);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=test"));
			expect(result.content).toContain("conflicts");
			expect(result.content).toContain("negative");
		});

		it("renders cross-field requires as sub-rows", async () => {
			const specWithRequires = makeSpec({
				paths: {
					"/api/test": {
						post: {
							summary: "Test requires",
							requestBody: {
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												botDefense: {
													type: "object",
													description: "Bot defense config",
													"x-f5xc-requires": [
														{
															field: "protected_app_endpoints",
															required: true,
															reason: "Bot defense needs endpoints",
														},
													],
												},
											},
										},
									},
								},
							},
							responses: {},
						},
					},
				},
			});
			const data = { dns: specWithRequires };
			const resolver = createApiSpecResolver(testIndex, data);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=test"));
			expect(result.content).toContain("requires");
			expect(result.content).toContain("protected_app_endpoints");
		});
	});

	describe("OneOf recommended variants", () => {
		it("shows recommended variant in oneOf groups from schema enrichments", async () => {
			const specWithOneOf = makeSpec({
				paths: {
					"/api/test": {
						post: {
							summary: "Test oneOf",
							operationId: "ves.io.schema.test.API.Create",
							requestBody: {
								content: {
									"application/json": {
										schema: { $ref: "#/components/schemas/TestLB" },
									},
								},
							},
							responses: {},
						},
					},
				},
				components: {
					schemas: {
						...makeSpec().components?.schemas,
						TestLB: {
							type: "object",
							"x-ves-oneof-field-lb_type": ["http", "https_auto_cert", "tcp"],
							properties: {
								http: { type: "object", description: "HTTP LB" },
								https_auto_cert: { type: "object", description: "HTTPS with auto cert" },
								tcp: { type: "object", description: "TCP LB" },
							},
						},
					},
				},
			});
			const oneOfEnrichments = {
				dns: {
					operationMeta: {},
					schemaEnrichments: {
						TestLB: { recommendedOneofVariant: { lb_type: "https_auto_cert" } },
					},
				},
			};
			const data = { dns: specWithOneOf };
			const resolver = createApiSpecResolver(testIndex, data, oneOfEnrichments);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=test"));
			expect(result.content).toContain("lb_type");
			expect(result.content).toContain("recommended");
			expect(result.content).toContain("https_auto_cert");
		});
	});

	describe("operationId normalization", () => {
		it("strips _get suffix from deduplicated operationId", async () => {
			const specWithSuffix = makeSpec({
				paths: {
					"/api/config/dns/namespaces/{ns}/dns_zones": {
						post: {
							summary: "Create DNS zone",
							operationId: "ves.io.schema.dns_zone.API.Create_post",
						},
						get: {
							summary: "List DNS zones",
							operationId: "ves.io.schema.dns_zone.API.List_get",
						},
					},
					"/api/config/dns/namespaces/{ns}/dns_zones/{name}": {
						get: {
							summary: "Get DNS zone",
							operationId: "ves.io.schema.dns_zone.API.Get_get",
						},
						delete: {
							summary: "Delete DNS zone",
							operationId: "ves.io.schema.dns_zone.API.Delete_delete",
						},
					},
				},
			});
			const indexNoApiPaths: ApiSpecIndex = {
				...testIndex,
				domains: [
					{
						...testIndex.domains[0],
						resources: [
							{ name: "dns_zone", description: "DNS zone" },
							{ name: "dns_record", description: "DNS records" },
						],
					},
					testIndex.domains[1],
				],
			};
			const data = { dns: specWithSuffix, cdn: testData.cdn };
			const resolver = createApiSpecResolver(indexNoApiPaths, data);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("Create DNS zone");
			expect(result.content).toContain("List DNS zones");
			expect(result.content).toContain("Get DNS zone");
			expect(result.content).toContain("Delete DNS zone");
		});

		it("filters CRUD operations with _post suffix when crudOnly=true", async () => {
			const specWithSuffix = makeSpec({
				paths: {
					"/api/config/dns/namespaces/{ns}/dns_zones": {
						post: {
							summary: "Create DNS zone",
							operationId: "ves.io.schema.dns_zone.API.Create_post",
						},
					},
					"/api/config/dns/namespaces/{ns}/dns_zones/custom_action": {
						post: {
							summary: "Custom action (should be excluded)",
							operationId: "ves.io.schema.dns_zone.CustomAPI.RunAction_post",
						},
					},
				},
			});
			const indexWithApiPaths: ApiSpecIndex = {
				...testIndex,
				domains: [
					{
						...testIndex.domains[0],
						resources: [
							{
								name: "dns_zone",
								description: "DNS zone",
								apiPaths: [
									"/api/config/dns/namespaces/{ns}/dns_zones",
									"/api/config/dns/namespaces/{ns}/dns_zones/custom_action",
								],
							},
						],
					},
					testIndex.domains[1],
				],
			};
			const data = { dns: specWithSuffix, cdn: testData.cdn };
			const resolver = createApiSpecResolver(indexWithApiPaths, data);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone&crud=true"));
			expect(result.content).toContain("Create DNS zone");
			expect(result.content).not.toContain("Custom action");
		});

		it("matches enrichments for suffixed operationIds", async () => {
			const specWithSuffix = makeSpec({
				paths: {
					"/api/config/dns/namespaces/{ns}/dns_zones": {
						post: {
							summary: "Create DNS zone",
							operationId: "ves.io.schema.dns_zone.API.Create_post",
						},
					},
				},
			});
			const enrichmentsWithSuffix = {
				dns: {
					operationMeta: {
						"ves.io.schema.dns_zone.API.Create_post": {
							dangerLevel: "medium" as const,
						},
					},
					schemaEnrichments: {},
				},
			};
			const indexNoApiPaths: ApiSpecIndex = {
				...testIndex,
				domains: [
					{
						...testIndex.domains[0],
						resources: [{ name: "dns_zone", description: "DNS zone" }],
					},
					testIndex.domains[1],
				],
			};
			const data = { dns: specWithSuffix, cdn: testData.cdn };
			const resolver = createApiSpecResolver(indexNoApiPaths, data, enrichmentsWithSuffix);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("medium");
		});

		it("handles _method_N suffix pattern", async () => {
			const specWithNumberedSuffix = makeSpec({
				paths: {
					"/api/config/dns/namespaces/{ns}/dns_zones": {
						get: {
							summary: "List DNS zones",
							operationId: "ves.io.schema.dns_zone.API.List_get_2",
						},
					},
				},
			});
			const indexNoApiPaths: ApiSpecIndex = {
				...testIndex,
				domains: [
					{
						...testIndex.domains[0],
						resources: [{ name: "dns_zone", description: "DNS zone" }],
					},
					testIndex.domains[1],
				],
			};
			const data = { dns: specWithNumberedSuffix, cdn: testData.cdn };
			const resolver = createApiSpecResolver(indexNoApiPaths, data);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("List DNS zones");
		});
	});

	describe("Validation route", () => {
		const validationData: Record<string, { create?: string[]; update?: string[]; minimum_config?: string[] }> = {
			dns_zone: {
				create: ["metadata.name", "metadata.namespace", "spec.dns_type"],
				update: ["metadata.name", "metadata.namespace"],
				minimum_config: ["metadata.name", "metadata.namespace"],
			},
			origin_pool: {
				create: ["metadata.name", "metadata.namespace", "spec.origin_servers", "spec.port"],
				update: ["metadata.name", "metadata.namespace"],
			},
		};

		it("renders validation index", async () => {
			const resolver = createApiSpecResolver(testIndex, testData, undefined, validationData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/validation/"));
			expect(result.content).toContain("Field Requirements");
			expect(result.content).toContain("dns_zone");
			expect(result.content).toContain("origin_pool");
		});

		it("renders validation detail for a resource", async () => {
			const resolver = createApiSpecResolver(testIndex, testData, undefined, validationData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/validation/dns_zone"));
			expect(result.content).toContain("dns_zone");
			expect(result.content).toContain("metadata.name");
			expect(result.content).toContain("spec.dns_type");
			expect(result.content).toContain("Minimum Configuration");
		});

		it("renders helpful error for unknown validation resource", async () => {
			const resolver = createApiSpecResolver(testIndex, testData, undefined, validationData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/validation/nonexistent"));
			expect(result.content).toContain("not found");
			expect(result.content).toContain("dns_zone");
		});

		it("shows empty state when no validation data", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/validation/"));
			expect(result.content).toContain("No validation data");
		});

		it("includes field requirements in resource spec view when validation data exists", async () => {
			const resolver = createApiSpecResolver(testIndex, testData, undefined, validationData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("Field Requirements");
			expect(result.content).toContain("metadata.name");
		});

		it("does not show field requirements when no validation data for resource", async () => {
			const resolver = createApiSpecResolver(testIndex, testData, undefined, validationData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_record"));
			expect(result.content).not.toContain("Field Requirements");
		});
	});

	describe("Minimum configuration rendering", () => {
		it("renders Quick Start section when min-config enrichment is present", async () => {
			const minConfigEnrichments = {
				dns: {
					operationMeta: {},
					schemaEnrichments: {
						dns_zone: {
							minimumConfiguration: {
								required_fields: ["metadata.name", "metadata.namespace"],
								example_json: '{"metadata":{"name":"example","namespace":"default"}}',
								example_curl: "curl -X POST https://example.com/api/dns_zones -d '{}'",
							},
						},
					},
				},
			};
			const indexWithSchema: ApiSpecIndex = {
				...testIndex,
				domains: [
					{
						...testIndex.domains[0],
						resources: [
							{
								name: "dns_zone",
								description: "DNS zone",
								schemaComponents: ["dns_zone"],
								apiPaths: ["/api/config/dns/namespaces/{ns}/dns_zones"],
							},
							{ name: "dns_record", description: "DNS records" },
						],
					},
					testIndex.domains[1],
				],
			};
			const data = { dns: makeSpec(), cdn: testData.cdn };
			const resolver = createApiSpecResolver(indexWithSchema, data, minConfigEnrichments);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).toContain("Quick Start");
			expect(result.content).toContain("metadata.name");
			expect(result.content).toContain("metadata.namespace");
			expect(result.content).toContain("example");
			expect(result.content).toContain("curl");
		});

		it("does not render Quick Start when no min-config data exists", async () => {
			const resolver = createApiSpecResolver(testIndex, testData);
			const result = await resolver.resolve(parseUrl("xcsh://api-spec/dns?resource=dns_zone"));
			expect(result.content).not.toContain("Quick Start");
		});
	});
});
