import { describe, expect, it } from "bun:test";
import {
	type ApiCatalogPreflightResource,
	classifyApiCatalogPreflight,
	runApiCatalogPreflight,
} from "../../src/internal-urls/api-catalog-preflight";

const resources: ApiCatalogPreflightResource[] = [
	{
		name: "http_loadbalancer",
		aliases: ["http load balancer", "http-lb"],
		domain: "virtual",
		categories: ["http-loadbalancers"],
	},
	{ name: "origin_pool", aliases: ["origin pool"], domain: "virtual", categories: ["origin-pools"] },
	{ name: "dns_zone", aliases: ["dns zone"], domain: "dns", categories: ["dns-dns-zones"] },
	{ name: "aws_vpc_site", aliases: ["aws vpc site"], domain: "site", categories: ["aws-vpc-sites"] },
	{ name: "azure_vnet_site", aliases: ["azure vnet site"], domain: "site", categories: ["azure-vnet-sites"] },
	{
		name: "gcp_vpc_site",
		aliases: ["gcp vpc site", "google cloud vpc site"],
		domain: "site",
		categories: ["gcp-vpc-sites"],
	},
	{ name: "kubernetes_cluster", aliases: ["kubernetes cluster"], domain: "site", categories: ["kubernetes-clusters"] },
];

describe("API catalog preflight", () => {
	it("classifies HTTP-LB route-limit intent and extracts only the resource phrase", () => {
		const intent = classifyApiCatalogPreflight("For F5 XC, what is the maximum number of routes on an HTTP-LB?", {
			toolsEnabled: true,
			resources,
		});
		expect(intent).toMatchObject({ resource: "http_loadbalancer", domain: "virtual" });
		expect(intent?.queries).toEqual(["http load balancer"]);
	});

	it("classifies required-field and CRUD endpoint questions deterministically", () => {
		expect(
			classifyApiCatalogPreflight("Which fields are required for an F5 XC origin pool payload?", {
				toolsEnabled: true,
				resources,
			})?.queries,
		).toEqual(["origin pool"]);
		expect(
			classifyApiCatalogPreflight("What endpoint creates a DNS zone in XC?", {
				toolsEnabled: true,
				resources,
			}),
		).toMatchObject({ resource: "dns_zone", queries: ["dns zone", "create dns zone"] });
	});

	it("prefers the resource owner with an authoritative catalog mapping", () => {
		const duplicateResources: ApiCatalogPreflightResource[] = [
			{ name: "origin_pool", aliases: ["origin pool"], domain: "service_mesh", categories: [] },
			{ name: "origin_pool", aliases: ["origin pool"], domain: "virtual", categories: ["origin-pools"] },
		];
		expect(
			classifyApiCatalogPreflight("Which fields are required for an F5 XC origin pool payload?", {
				toolsEnabled: true,
				resources: duplicateResources,
			}),
		).toMatchObject({ resource: "origin_pool", domain: "virtual" });
	});

	it("keeps F5 XC cloud-named resources in scope while rejecting third-party questions", () => {
		for (const [prompt, resource] of [
			["What endpoint creates an F5 XC AWS VPC site?", "aws_vpc_site"],
			["What endpoint creates an F5 XC Azure VNet site?", "azure_vnet_site"],
			["What endpoint creates an F5 XC GCP VPC site?", "gcp_vpc_site"],
			["What endpoint creates an F5 XC Google Cloud VPC site?", "gcp_vpc_site"],
			["What endpoint creates an F5 XC Kubernetes cluster?", "kubernetes_cluster"],
		] as const) {
			expect(
				classifyApiCatalogPreflight(prompt, {
					toolsEnabled: true,
					resources,
				}),
			).toMatchObject({ resource, domain: "site" });
		}
		for (const prompt of [
			"What endpoint creates an AWS origin pool?",
			"What endpoint creates an Azure origin pool?",
			"What endpoint creates a GCP origin pool?",
			"What endpoint creates a Google Cloud origin pool?",
			"What endpoint creates a Kubernetes origin pool?",
		]) {
			expect(
				classifyApiCatalogPreflight(prompt, {
					toolsEnabled: true,
					resources,
				}),
			).toBeNull();
		}
	});

	it("uses only an explicitly supplied immediately preceding resource for anaphoric metadata", () => {
		const previousResource = {
			resource: "http_loadbalancer",
			domain: "virtual",
			queries: ["http load balancer"],
		};
		expect(
			classifyApiCatalogPreflight("What is its maximum?", {
				toolsEnabled: true,
				resources,
				previousResource,
			}),
		).toEqual(previousResource);
		expect(
			classifyApiCatalogPreflight("Tell me a joke", { toolsEnabled: true, resources, previousResource }),
		).toBeNull();
		expect(
			classifyApiCatalogPreflight("What is its maximum?", {
				toolsEnabled: false,
				resources,
				previousResource,
			}),
		).toBeNull();
	});

	it.each([
		"What is F5 XC WAAP?",
		"Show the Terraform resource for an F5 XC HTTP load balancer",
		"Troubleshoot why my F5 XC HTTP load balancer is returning 503",
		"What is the AWS Application Load Balancer API endpoint?",
		"What endpoint creates an AWS origin pool?",
		"What is the maximum number of routes in this unrelated proxy?",
	])("does not preflight negative control: %s", prompt => {
		expect(classifyApiCatalogPreflight(prompt, { toolsEnabled: true, resources })).toBeNull();
	});

	it("does not preflight when tools are disabled", () => {
		expect(
			classifyApiCatalogPreflight("What is the F5 XC HTTP-LB route limit?", {
				toolsEnabled: false,
				resources,
			}),
		).toBeNull();
	});

	it("merges and deduplicates the top five ranked destinations", async () => {
		const result = await runApiCatalogPreflight("Create an F5 XC DNS zone", {
			toolsEnabled: true,
			resources,
			catalogVersion: "6.0.2",
			rank: async query =>
				query.startsWith("create")
					? ["dns-dns-zones", "dns-dns-zone-import"]
					: ["dns-dns-zones", "dns-dns-zone-clone-from-dns-domain"],
		});
		expect(result?.queries).toEqual(["dns zone", "create dns zone"]);
		expect(result?.ranked.map(candidate => candidate.category)).toEqual([
			"dns-dns-zones",
			"dns-dns-zone-clone-from-dns-domain",
			"dns-dns-zone-import",
		]);
		expect(result?.ranked[0]).toMatchObject({
			resource: "dns_zone",
			domain: "dns",
			catalogUrl: "xcsh://api-catalog/dns-dns-zones",
			specUrl: "xcsh://api-spec/dns?resource=dns_zone",
		});
	});

	it("includes CRUD-specific results when the alias query already returns five candidates", async () => {
		const result = await runApiCatalogPreflight("Create an F5 XC DNS zone", {
			toolsEnabled: true,
			resources,
			catalogVersion: "6.0.2",
			rank: async query =>
				query.startsWith("create")
					? ["dns-create", "dns-import", "dns-zones", "dns-four", "dns-five"]
					: ["dns-zones", "dns-clone", "dns-three", "dns-four", "dns-five"],
		});
		expect(result?.ranked.map(candidate => candidate.category)).toEqual([
			"dns-zones",
			"dns-create",
			"dns-clone",
			"dns-import",
			"dns-three",
		]);
	});

	it("never lets a QMD-ranked category substitute a different resource owner", async () => {
		const result = await runApiCatalogPreflight("Create an F5 XC DNS zone", {
			toolsEnabled: true,
			resources,
			catalogVersion: "6.0.2",
			rank: async () => ["origin-pools"],
		});
		expect(result?.ranked[0]).toMatchObject({
			category: "origin-pools",
			resource: "dns_zone",
			domain: "dns",
			resourceUrl: "xcsh://api-catalog/?resource=dns_zone&compact=true",
			specUrl: "xcsh://api-spec/dns?resource=dns_zone",
		});
	});

	it("fails closed with a local discovery error", async () => {
		await expect(
			runApiCatalogPreflight("What is the F5 XC HTTP-LB route limit?", {
				toolsEnabled: true,
				resources,
				catalogVersion: "6.0.2",
				rank: async () => {
					throw new Error("corrupt index");
				},
			}),
		).rejects.toThrow("Local API catalog discovery failed: corrupt index");
	});
});
