import { describe, expect, it } from "bun:test";
import {
	buildKnowledgeSearchPlan,
	classifyKnowledgeRequest,
	type KnowledgeClassifierResource,
} from "../../src/internal-urls/knowledge-classifier";

const resources: KnowledgeClassifierResource[] = [
	{
		name: "http_loadbalancer",
		aliases: ["http load balancer", "http-lb"],
		domain: "virtual",
		categories: ["http-loadbalancers"],
	},
	{ name: "dns_zone", aliases: ["dns zone"], domain: "dns", categories: ["dns-dns-zones"] },
];

describe("deterministic knowledge classifier", () => {
	it("emits structured API queries and an authoritative domain constraint", () => {
		const result = classifyKnowledgeRequest("What endpoint creates an F5 XC DNS zone?", {
			toolsEnabled: true,
			resources,
		});
		expect(result).toMatchObject({
			route: "api",
			confidence: 0.99,
			resource: "dns_zone",
			domain: "dns",
			constraints: { domain: "dns" },
			query: {
				intent: "Find the authoritative F5 Distributed Cloud API operation for creating dns zone.",
				lex: ["dns zone", "create dns zone"],
			},
		});
		expect(result.query.vec).toEqual(["create dns zone F5 Distributed Cloud API"]);
		expect(result.query.hyde[0]).toContain("method, path, operation ID, request fields, and constraints");
	});

	it("routes documentation questions with source isolation and deterministic HyDE", () => {
		const result = classifyKnowledgeRequest("Use F5 documentation to configure a web application firewall", {
			toolsEnabled: true,
			resources,
			documentationSource: "docs-cloud-f5-com",
		});
		expect(result).toMatchObject({
			route: "documentation",
			confidence: 0.99,
			constraints: { source: "docs-cloud-f5-com" },
		});
		expect(result.query.lex[0]).toBe("configure web application firewall");
		expect(result.query.hyde[0]).toContain("authoritative F5 documentation page");
	});

	it("selects marketing, operational, community, and support sources by question intent", () => {
		expect(classifyKnowledgeRequest("What is client side defense?", { toolsEnabled: true, resources })).toMatchObject(
			{
				route: "documentation",
				source: "www-f5-com",
				constraints: { source: "www-f5-com" },
			},
		);
		expect(
			classifyKnowledgeRequest("How do I configure F5 Distributed Cloud DNS?", { toolsEnabled: true, resources }),
		).toMatchObject({ source: "docs-cloud-f5-com", constraints: { source: "docs-cloud-f5-com" } });
		expect(
			classifyKnowledgeRequest("Troubleshoot an F5 Distributed Cloud certificate issue", {
				toolsEnabled: true,
				resources,
			}),
		).toMatchObject({ source: "community-f5-com", constraints: { source: "community-f5-com" } });
		expect(
			classifyKnowledgeRequest("Find the F5 support article K1234567", { toolsEnabled: true, resources }),
		).toMatchObject({ source: "my-f5-com", constraints: { source: "my-f5-com" } });
		expect(
			classifyKnowledgeRequest("Show a community example for F5 DNS zone creation", {
				toolsEnabled: true,
				resources,
			}),
		).toMatchObject({ source: "community-f5-com", constraints: { source: "community-f5-com" } });
	});

	it("recognizes exact xcsh URIs without rewriting them", () => {
		const uri = "xcsh://api-spec/dns?resource=dns_zone";
		expect(classifyKnowledgeRequest(`Read ${uri}`, { toolsEnabled: true, resources })).toMatchObject({
			route: "direct-uri",
			confidence: 1,
			directUri: uri,
			constraints: { domain: "dns" },
		});
	});

	it("preserves the marketing source on exact documentation URIs", () => {
		const uri = "xcsh://documentation/www-f5-com/products/distributed-cloud-services/client-side-defense/index.md";
		expect(classifyKnowledgeRequest(`Read ${uri}`, { toolsEnabled: true, resources })).toMatchObject({
			route: "direct-uri",
			directUri: uri,
			constraints: { source: "www-f5-com" },
		});
	});

	it("preserves numeric community topic identity on exact reads", () => {
		const uri = "xcsh://documentation/community-f5-com/t/65170/index.md";
		expect(classifyKnowledgeRequest(`Read ${uri}`, { toolsEnabled: true, resources })).toMatchObject({
			route: "direct-uri",
			directUri: uri,
			constraints: { source: "community-f5-com" },
		});
	});

	it("uses only bounded prior-turn context for anaphoric follow-ups", () => {
		const prior = classifyKnowledgeRequest("What endpoint creates an F5 XC DNS zone?", {
			toolsEnabled: true,
			resources,
		});
		expect(
			classifyKnowledgeRequest("What are its required fields?", { toolsEnabled: true, resources, previous: prior }),
		).toMatchObject({
			route: "api",
			resource: "dns_zone",
			domain: "dns",
		});
		expect(
			classifyKnowledgeRequest("What are its required fields?", { toolsEnabled: false, resources, previous: prior })
				.route,
		).toBe("none");
	});

	it("rejects third-party and unrelated requests without results", () => {
		for (const prompt of [
			"What endpoint creates an AWS DNS zone?",
			"Show me Kubernetes pricing",
			"Tell me a joke",
			"quantum sandwich controller",
		]) {
			const result = classifyKnowledgeRequest(prompt, { toolsEnabled: true, resources });
			expect(result.route).toBe("none");
			expect(result.confidence).toBe(0);
		}
	});

	it("builds stable structured plans for explicit documentation search", () => {
		expect(buildKnowledgeSearchPlan("documentation", "set up DNS load balancer")).toEqual({
			intent: "Find the authoritative F5 documentation page for setting up dns load balancer.",
			lex: ["set up dns load balancer"],
			vec: ["set up DNS load balancer F5 documentation"],
			hyde: [
				"An authoritative F5 documentation page explains how to set up DNS load balancer with prerequisites, ordered steps, verification, and limitations.",
			],
		});
	});
});
