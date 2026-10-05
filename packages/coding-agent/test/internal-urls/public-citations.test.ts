import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import {
	DocumentationCitationStream,
	normalizeAssistantDocumentationCitations,
	projectAssistantDocumentationCitations,
	publicCitationForApiOperation,
	publicCitationForInternalUri,
} from "../../src/internal-urls/public-citations";
import { extractReferences } from "../../src/references";

describe("public documentation citations", () => {
	test("maps exact current source documents and strips only internal retrieval parameters", () => {
		const community = publicCitationForInternalUri(
			"xcsh://documentation/community-f5-com/t/65170/index.md#api-discovery",
		);
		expect(community && "publicUrl" in community && community.publicUrl).toBe("https://community.f5.com/t/65170");
		const terraform = publicCitationForInternalUri(
			"xcsh://terraform-documentation/documentation/resources/http_loadbalancer/index.md?view=context#schema-foo",
		);
		expect(terraform && "publicUrl" in terraform && terraform.publicUrl).toBe(
			"https://f5-sales-demo.github.io/terraform-provider-xcsh/resources/http_loadbalancer/",
		);
		expect(terraform && "publicUrl" in terraform && terraform.sectionLevelLinkAvailable).toBe(false);
		const api = publicCitationForInternalUri("xcsh://api-spec/virtual?resource=http_loadbalancer");
		expect(api && "publicUrl" in api && api.publicUrl).toBe(
			"https://f5-sales-demo.github.io/api-specs-enriched/api-reference/virtual/",
		);
	});

	test("fails closed for missing paths and conflicting API operation destinations", () => {
		expect(publicCitationForInternalUri("xcsh://documentation/community-f5-com/t/999999999/index.md")).toEqual({
			readUri: "xcsh://documentation/community-f5-com/t/999999999/index.md",
			reason: "missing-public-mapping",
		});
		const ambiguous = publicCitationForApiOperation(
			"xcsh://api-catalog/aggregation",
			"POST",
			"/api/data/namespaces/{namespace}/firewall_logs/aggregation",
			"ves.io.schema.log.CustomAPI.FirewallLogAggregationQuery",
		);
		expect("reason" in ambiguous && ambiguous.reason).toBe("conflicting-public-mapping");
	});

	test("binds an API citation to its exact published operation tuple", () => {
		const read = "xcsh://api-catalog/http-loadbalancers";
		const result = publicCitationForApiOperation(
			read,
			"POST",
			"/api/config/namespaces/{namespace}/http_loadbalancers",
			"ves.io.schema.views.http_loadbalancer.API.Create",
		);
		expect(result && "publicUrl" in result && result.publicUrl).toBe(
			"https://f5-sales-demo.github.io/api-specs-enriched/api-reference/virtual/",
		);
		expect(result && "publicUrl" in result && result.sectionLevelLinkAvailable).toBe(false);
	});

	test("normalizes assistant links and structured citations while preserving code literals", () => {
		const read = "xcsh://documentation/community-f5-com/t/65170/index.md";
		const message = {
			role: "assistant",
			content: [
				{
					type: "text",
					text: `Source: [Community](${read})\n\n\`${read}\`\n\n\`\`\`text\n${read}\n\`\`\``,
					citations: [
						{ type: "web_search_result_location", url: read, title: "Community", encryptedIndex: "opaque" },
					],
				},
			],
		} as AssistantMessage;
		const result = projectAssistantDocumentationCitations(message);
		const block = result.content[0];
		expect(block?.type).toBe("text");
		if (block?.type !== "text") return;
		expect(block.text).toContain("[Community](https://community.f5.com/t/65170)");
		expect(block.text).toContain(`\`${read}\``);
		expect(block.text).toContain(`\`\`\`text\n${read}\n\`\`\``);
		expect(block.citations?.[0]?.url).toBe("https://community.f5.com/t/65170");
		expect(block.citations?.[0]?.encryptedIndex).toBe("opaque");
		expect(message.content[0]).not.toBe(block);
		expect(extractReferences(message).map(reference => reference.url)).toEqual(["https://community.f5.com/t/65170"]);
	});

	test("does not expose an internal citation split across streaming chunks", () => {
		const stream = new DocumentationCitationStream();
		const chunks = ["See xc", "sh://documentation/community-f5-com/t/65170/", "index.md for the example."];
		const visible = chunks.map(chunk => stream.push(chunk)).join("") + stream.complete();
		expect(visible).toBe("See https://community.f5.com/t/65170 for the example.");
		expect(visible).not.toContain("xcsh://");
		expect(normalizeAssistantDocumentationCitations(visible)).toBe(visible);
	});
});
