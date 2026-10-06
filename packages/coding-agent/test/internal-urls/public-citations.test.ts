import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import { PUBLIC_CITATION_SOURCES } from "../../src/internal-urls/public-citation-destinations.generated";
import {
	DocumentationCitationStream,
	normalizeAssistantDocumentationCitations,
	projectAssistantDocumentationCitations,
	projectDocumentationTranscript,
	publicCitationForApiOperation,
	publicCitationForInternalUri,
	SessionCitationRegistry,
} from "../../src/internal-urls/public-citations";
import { extractReferences } from "../../src/references";

describe("public documentation citations", () => {
	test("historical read provenance binds a public page to its original version and digest", () => {
		const read =
			"xcsh://terraform-documentation/documentation/resources/http_loadbalancer/index.md?view=context#schema-domains";
		const publicUrl = "https://f5-sales-demo.github.io/terraform-provider-xcsh/resources/http_loadbalancer/";
		const oldDigest = `sha256:${"a".repeat(64)}`;
		const toolResult = {
			role: "toolResult",
			toolName: "read",
			isError: false,
			details: { meta: { source: { type: "internal", value: read } } },
			content: [
				{
					type: "text",
					text: `Cite: ${publicUrl} (document page; section link unavailable; documentation-v12.4.0, ${oldDigest})\n\nSource section`,
				},
			],
		} as AgentMessage;
		const registry = new SessionCitationRegistry([toolResult]);
		const bound = registry.resolve(read);
		expect(bound && "publicUrl" in bound && bound.publicUrl).toBe(publicUrl);
		expect(bound && "publicUrl" in bound && bound.sourceVersion).toBe("documentation-v12.4.0");
		expect(bound && "publicUrl" in bound && bound.sourceDigest).toBe(oldDigest);
	});

	test("old history without a verified public mapping fails closed and keeps its evidence unchanged", () => {
		const read = "xcsh://terraform-documentation/documentation/resources/http_loadbalancer/index.md#schema-domains";
		const oldToolResult = {
			role: "toolResult",
			toolName: "read",
			isError: false,
			details: { meta: { source: { type: "internal", value: "xcsh://terraform-documentation/?search=domains" } } },
			content: [
				{
					type: "text",
					text: "Provider: v12.4.0\nSnapshot: documentation-v12.4.0\nRead: xcsh://terraform-documentation/documentation/resources/http_loadbalancer/index.md#schema-domains",
				},
			],
		} as AgentMessage;
		const assistant = { role: "assistant", content: [{ type: "text", text: `See ${read}` }] } as AssistantMessage;
		const projected = projectDocumentationTranscript([oldToolResult, assistant]);
		expect(JSON.stringify(projected[0])).toContain(read);
		expect(JSON.stringify(projected[1])).toContain("[unverified documentation citation]");
		expect(JSON.stringify(projected[1])).not.toContain(read);
		expect(assistant.content[0]?.type === "text" && assistant.content[0].text).toContain(read);
	});

	test("historical API catalog headings cannot inherit the current reference version", () => {
		const read = "xcsh://api-spec/virtual?resource=http_loadbalancer";
		const oldResult = {
			role: "toolResult",
			toolName: "read",
			isError: false,
			details: { meta: { source: { type: "internal", value: read } } },
			content: [{ type: "text", text: "# F5 XC API Specifications (v10.0.0)\n\nOlder reference" }],
		} as AgentMessage;
		expect(new SessionCitationRegistry([oldResult]).resolve(read)).toEqual({
			readUri: read,
			reason: "conflicting-source-version",
		});
	});

	test("a retired historical document cannot acquire an unverified current public page", () => {
		const read = "xcsh://terraform-documentation/documentation/resources/retired_resource/index.md#old";
		const oldResult = {
			role: "toolResult",
			toolName: "read",
			isError: false,
			details: { meta: { source: { type: "internal", value: read } } },
			content: [
				{
					type: "text",
					text: `Cite: https://f5-sales-demo.github.io/terraform-provider-xcsh/resources/retired_resource/ (document page; section link unavailable; documentation-v12.4.0, sha256:${"a".repeat(64)})`,
				},
			],
		} as AgentMessage;
		expect(new SessionCitationRegistry([oldResult]).resolve(read)).toEqual({
			readUri: read,
			reason: "conflicting-source-version",
		});
	});

	test("publication mapping provenance agrees with every reviewed source pin", async () => {
		const root = path.resolve(import.meta.dir, "../../../../tools");
		const [content, provider, api] = await Promise.all([
			Bun.file(path.join(root, "documentation-release.json")).json(),
			Bun.file(path.join(root, "terraform-documentation-release.json")).json(),
			Bun.file(path.join(root, "spec-release.json")).json(),
		]);
		expect(PUBLIC_CITATION_SOURCES.general.version).toBe(content.release_tag);
		expect(PUBLIC_CITATION_SOURCES.general.digest).toBe(content.assets["html-to-markdown-content.tar.gz"].sha256);
		expect(PUBLIC_CITATION_SOURCES.terraform.version).toBe(provider.release_tag);
		expect(PUBLIC_CITATION_SOURCES.terraform.digest).toBe(provider.assets["canonical-documentation.tar.gz"].sha256);
		expect(PUBLIC_CITATION_SOURCES.api.version).toBe(api.release_tag);
		expect(PUBLIC_CITATION_SOURCES.api.digest).toBe(api.assets[`f5xc-api-specs-${api.release_tag}.zip`].slice(7));
	});

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
		const ordinary = new DocumentationCitationStream();
		expect(ordinary.push("All done, the echo came back.")).toBe("All done, the echo came back.");
		const stream = new DocumentationCitationStream();
		const chunks = ["See xc", "sh://documentation/community-f5-com/t/65170/", "index.md for the example."];
		const visible = chunks.map(chunk => stream.push(chunk)).join("") + stream.complete();
		expect(visible).toBe("See https://community.f5.com/t/65170 for the example.");
		expect(visible).not.toContain("xcsh://");
		expect(normalizeAssistantDocumentationCitations(visible)).toBe(visible);
		const trailing = new DocumentationCitationStream();
		expect(trailing.push("Cite xcsh://documentation/community-f5-com/t/65170/index.md")).toBe("Cite ");
		expect(trailing.complete()).toBe("https://community.f5.com/t/65170");
		expect(normalizeAssistantDocumentationCitations("See xcsh://docs/about and agent://output/123")).toBe(
			"See [unverified documentation citation] and agent://output/123",
		);
	});
});
