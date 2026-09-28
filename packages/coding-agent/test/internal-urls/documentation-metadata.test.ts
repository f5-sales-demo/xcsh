import { describe, expect, it } from "bun:test";
import {
	githubHeadingAnchor,
	parseDocumentationMetadata,
	splitHeadingPassages,
	validateDocumentationGraph,
} from "../../src/internal-urls/documentation-metadata";
import type { DocumentationSource } from "../../src/internal-urls/documentation-resolve";

const ROOTS: Record<DocumentationSource, string> = {
	"docs-cloud-f5-com": "https://docs.cloud.f5.com/docs-v2",
	"my-f5-com": "https://my.f5.com/manage/s",
	"www-f5-com": "https://www.f5.com/products/distributed-cloud-services",
};

function validateUrl(value: unknown, source: DocumentationSource | undefined): string {
	if (
		typeof value !== "string" ||
		(source !== undefined && !value.startsWith(ROOTS[source])) ||
		(source === undefined && !Object.values(ROOTS).some(root => value.startsWith(root)))
	)
		throw new Error("outside source");
	return value;
}

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		metadata_schema: 1,
		product: "client-side-defense",
		content_type: "how_to",
		task_type: "configure",
		canonical_url: "https://docs.cloud.f5.com/docs-v2/client-side-defense/how-tos/configure-csd",
		last_updated: "2026-09-28",
		language: "en",
		aliases: ["Client-Side Defense", "CSD"],
		lifecycle: "current",
		replacement_url: null,
		related_documents: [],
		...overrides,
	};
}

describe("documentation metadata", () => {
	it("validates the controlled contract and nullable product/date", () => {
		const parsed = parseDocumentationMetadata(
			metadata({ product: null, last_updated: null }),
			validateUrl,
			"docs-cloud-f5-com",
			"document",
		);
		expect(parsed.product).toBeNull();
		expect(parsed.contentType).toBe("how_to");
	});

	it.each([
		["metadata_schema", 2],
		["product", "Not A Slug"],
		["content_type", "guide"],
		["task_type", "install"],
		["language", "not_a_tag"],
		["lifecycle", "removed"],
		["aliases", ["CSD", "Client-Side Defense"]],
	])("rejects invalid %s", (field, value) => {
		expect(() =>
			parseDocumentationMetadata(metadata({ [field]: value }), validateUrl, "docs-cloud-f5-com", "document"),
		).toThrow();
	});

	it("requires replacement only for superseded documents", () => {
		expect(() =>
			parseDocumentationMetadata(
				metadata({ lifecycle: "superseded" }),
				validateUrl,
				"docs-cloud-f5-com",
				"document",
			),
		).toThrow("replacement_url");
	});
});

describe("heading passages", () => {
	it("uses GitHub-compatible duplicate and Unicode anchors", () => {
		const occurrences = new Map<string, number>();
		expect(githubHeadingAnchor("Café & API", occurrences)).toBe("café--api");
		expect(githubHeadingAnchor("Café & API", occurrences)).toBe("café--api-1");
	});

	it("splits H1-H3 and ignores fenced code headings", () => {
		const passages = splitHeadingPassages(
			"Preamble\n\n# Page\n\nIntro\n\n## Configure\n\nSteps\n\n```md\n## Not a heading\n```\n\n## Configure\n\nAgain\n\n#### Detail\n\nKeep detail.\n",
		);
		expect(passages.map(item => item.anchor)).toEqual(["page", "configure", "configure-1"]);
		expect(passages[0]?.markdown).toStartWith("# Page");
		expect(passages[1]?.markdown).toContain("## Not a heading");
		expect(passages[2]?.markdown).toContain("#### Detail");
	});

	it("provides a deterministic passage for headingless content", () => {
		expect(splitHeadingPassages("Plain text\n")).toEqual([
			{ anchor: "document", heading: "Document", markdown: "Plain text\n", ordinal: 0 },
		]);
	});

	it("retains empty sections and bounds them at the next indexed heading", () => {
		const passages = splitHeadingPassages("# Page\n\n## Empty\n\n## Next\n\nBody\n");
		expect(passages[1]).toEqual({ anchor: "empty", heading: "Empty", markdown: "## Empty\n", ordinal: 1 });
		expect(passages[2]?.markdown).toBe("## Next\n\nBody\n");
	});
});

describe("documentation relationship graph", () => {
	it("accepts cycles and rejects unresolved or mismatched targets", () => {
		const firstUrl = "https://docs.cloud.f5.com/docs-v2/first";
		const secondUrl = "https://my.f5.com/manage/s/article/K000000002";
		const first = parseDocumentationMetadata(
			metadata({
				canonical_url: firstUrl,
				related_documents: [
					{
						relation: "support",
						title: "Second",
						canonical_url: secondUrl,
						source_id: "my-f5-com",
						stable_path: "K000000002",
					},
				],
			}),
			validateUrl,
			"docs-cloud-f5-com",
			"first",
		);
		const second = parseDocumentationMetadata(
			metadata({
				product: null,
				content_type: "knowledge_article",
				task_type: "support",
				canonical_url: secondUrl,
				related_documents: [
					{
						relation: "configure",
						title: "First",
						canonical_url: firstUrl,
						source_id: "docs-cloud-f5-com",
						stable_path: "first",
					},
				],
			}),
			validateUrl,
			"my-f5-com",
			"second",
		);
		const nodes = [
			{ source: "docs-cloud-f5-com" as const, stablePath: "first", title: "First", metadata: first },
			{ source: "my-f5-com" as const, stablePath: "K000000002", title: "Second", metadata: second },
		];
		expect(() => validateDocumentationGraph(nodes)).not.toThrow();
		expect(() => validateDocumentationGraph(nodes.slice(0, 1))).toThrow("missing or ambiguous");
		expect(() =>
			validateDocumentationGraph([
				{ ...nodes[0]!, title: "Wrong", metadata: { ...first, relatedDocuments: [] } },
				nodes[1]!,
			]),
		).toThrow("metadata mismatch");
	});
});
