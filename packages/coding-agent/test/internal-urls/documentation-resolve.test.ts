import { describe, expect, it } from "bun:test";
import {
	createDocumentationResolver,
	type DocumentationRepository,
} from "../../src/internal-urls/documentation-resolve";
import { InternalUrlRouter } from "../../src/internal-urls/router";
import { InternalDocsProtocolHandler } from "../../src/internal-urls/xcsh-protocol";

const markdown = "---\ntitle: Protect applications\n---\n\n# Protect applications\n\nConfigure a load balancer.\n";

function repository(): DocumentationRepository {
	return {
		provenance: {
			releaseTag: "content-20260926T214508Z",
			sourceCommit: "33666ec99d0dc271656dd75b1832c9a64f7bcb37",
			archiveSha256: "3".repeat(64),
			indexSha256: "4".repeat(64),
			fingerprint: "5".repeat(64),
			documentCount: 2,
			assetCount: 1,
		},
		async search(query, source, limit, filters) {
			expect(["protect applications", "what is client side defense"]).toContain(query);
			expect(limit).toBe(source === undefined ? 5 : 1);
			const rows = [
				{
					title: "Protect applications",
					source: "docs-cloud-f5-com" as const,
					originalUrl: "https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection",
					stablePath: "web-app-and-api-protection",
					anchor: "protect-applications",
					heading: "Protect applications",
					snippet: "Configure a load balancer.",
					score: 7.25,
					product: "web-application-firewall",
					contentType: "how_to" as const,
					taskType: "configure" as const,
					language: "en",
					lifecycle: "current" as const,
					replacementUrl: null,
					relatedDocuments: [
						{
							relation: "support" as const,
							title: "Support article",
							canonicalUrl: "https://my.f5.com/manage/s/article/K000000001",
							source: "my-f5-com" as const,
							stablePath: "K000000001",
						},
					],
				},
				{
					title: "Support article",
					source: "my-f5-com" as const,
					originalUrl: "https://my.f5.com/manage/s/article/K000000001",
					stablePath: "K000000001",
					anchor: "support-article",
					heading: "Support article",
					snippet: "Support content.",
					score: 4.5,
					product: null,
					contentType: "knowledge_article" as const,
					taskType: "support" as const,
					language: "en",
					lifecycle: "deprecated" as const,
					replacementUrl: null,
					relatedDocuments: [],
				},
				{
					title: "Client-Side Defense",
					source: "www-f5-com" as const,
					originalUrl: "https://www.f5.com/products/distributed-cloud-services/client-side-defense",
					stablePath: "products/distributed-cloud-services/client-side-defense",
					anchor: "client-side-defense",
					heading: "Client-Side Defense",
					snippet: "Protect web applications from malicious scripts.",
					score: 8.5,
					product: "client-side-defense",
					contentType: "product_overview" as const,
					taskType: "concept" as const,
					language: "en",
					lifecycle: "current" as const,
					replacementUrl: null,
					relatedDocuments: [],
				},
			];
			return rows
				.filter(row => source === undefined || row.source === source)
				.filter(row => filters?.product === undefined || row.product === filters.product)
				.slice(0, limit);
		},
		async readDocument(source, stablePath, anchor) {
			if (source === "docs-cloud-f5-com" && stablePath === "web-app-and-api-protection" && anchor) {
				return anchor === "protect-applications"
					? {
							markdown: "# Protect applications\n\nConfigure a load balancer.\n",
							title: "Protect applications",
							originalUrl: "https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection",
							lifecycle: "current" as const,
							replacementUrl: null,
						}
					: null;
			}
			if (source === "my-f5-com" && stablePath === "K000000001") {
				return {
					markdown: "# Support article\n",
					title: "Support article",
					originalUrl: "https://my.f5.com/manage/s/article/K000000001",
					lifecycle: "deprecated" as const,
					replacementUrl: null,
				};
			}
			return source === "docs-cloud-f5-com" && stablePath === "web-app-and-api-protection"
				? {
						markdown,
						title: "Protect applications",
						originalUrl: "https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection",
						lifecycle: "current",
						replacementUrl: null,
					}
				: source === "www-f5-com" && stablePath === "products/distributed-cloud-services/client-side-defense"
					? {
							markdown: "# Client-Side Defense\n",
							title: "Client-Side Defense",
							originalUrl: "https://www.f5.com/products/distributed-cloud-services/client-side-defense",
							lifecycle: "current",
							replacementUrl: null,
						}
					: null;
		},
		async readAsset(source, stablePath, filename) {
			return (source === "docs-cloud-f5-com" &&
				stablePath === "web-app-and-api-protection" &&
				filename === `${"a".repeat(64)}.png`) ||
				(source === "www-f5-com" &&
					stablePath === "products/distributed-cloud-services/client-side-defense" &&
					filename === `${"b".repeat(64)}.webp`)
				? {
						data: Buffer.from("png-bytes").toString("base64"),
						mimeType: filename.endsWith(".webp") ? "image/webp" : "image/png",
					}
				: null;
		},
	};
}

function router(): InternalUrlRouter {
	const value = new InternalUrlRouter();
	value.register({
		scheme: "xcsh",
		resolve: createDocumentationResolver(repository()).resolve,
	});
	return value;
}

describe("xcsh://documentation", () => {
	it("is wired through the default xcsh protocol handler", async () => {
		const value = new InternalUrlRouter();
		value.register(new InternalDocsProtocolHandler({ documentationRepository: repository() }));
		const result = await value.resolve("xcsh://documentation/");
		expect(result.content).toContain("# Offline F5 documentation");
	});

	it("renders bounded inventory and pinned provenance", async () => {
		const result = await router().resolve("xcsh://documentation/");
		expect(result.content).toContain("content-20260926T214508Z");
		expect(result.content).not.toContain("1,039");
		expect(result.content).toContain("2 documents");
		expect(result.content).toContain("docs-cloud-f5-com");
		expect(result.content).toContain("my-f5-com");
		expect(result.content).toContain("www-f5-com");
	});

	it("searches and reads the reviewed marketing collection", async () => {
		const result = await router().resolve(
			"xcsh://documentation/?search=what%20is%20client%20side%20defense&source=www-f5-com&limit=1",
		);
		expect(result.content).toContain("Client-Side Defense");
		expect(result.content).toContain(
			"xcsh://documentation/www-f5-com/products/distributed-cloud-services/client-side-defense/index.md#client-side-defense",
		);
		const document = await router().resolve(
			"xcsh://documentation/www-f5-com/products/distributed-cloud-services/client-side-defense/index.md",
		);
		expect(document.content).toStartWith(
			"Cite: https://www.f5.com/products/distributed-cloud-services/client-side-defense",
		);
		expect(document.content).toEndWith("# Client-Side Defense\n");
	});

	it("returns reviewed marketing image assets", async () => {
		const result = await router().resolve(
			`xcsh://documentation/www-f5-com/products/distributed-cloud-services/client-side-defense/assets/${"b".repeat(64)}.webp`,
		);
		expect(result.contentType).toBe("image/webp");
		expect(result.encoding).toBe("base64");
	});

	it("searches all sources with five results by default and exact follow-up URLs", async () => {
		const result = await router().resolve("xcsh://documentation/?search=protect%20applications");
		expect(result.content).toContain("Protect applications");
		expect(result.content).toContain(
			"xcsh://documentation/docs-cloud-f5-com/web-app-and-api-protection/index.md#protect-applications",
		);
		expect(result.content).toContain("xcsh://documentation/my-f5-com/K000000001/index.md");
		expect(result.content).toContain("Snapshot: `content-20260926T214508Z`");
	});

	it("supports source filtering and limits 1 through 10", async () => {
		const result = await router().resolve(
			"xcsh://documentation/?search=protect%20applications&source=my-f5-com&limit=1",
		);
		expect(result.content).toContain("Support article");
		expect(result.content).toContain("Warning: this document is deprecated");
		expect(result.content).not.toContain("Protect applications");
		const exact = await router().resolve("xcsh://documentation/my-f5-com/K000000001/index.md");
		expect(exact.content).toStartWith("Cite: unavailable (missing-public-mapping");
		expect(exact.content).toContain("> Warning: this document is deprecated.");
	});

	it("passes normalized metadata filters and rejects invalid or duplicate values", async () => {
		const result = await router().resolve(
			"xcsh://documentation/?search=protect%20applications&product=web-application-firewall&content_type=how_to&task_type=configure&language=en&lifecycle=current",
		);
		expect(result.content).toContain("Product: web-application-firewall");
		for (const invalid of [
			"product=Not-A-Slug",
			"content_type=guide",
			"task_type=install",
			"language=not_a_tag",
			"lifecycle=removed",
		]) {
			await expect(router().resolve(`xcsh://documentation/?search=x&${invalid}`)).rejects.toThrow();
		}
		await expect(router().resolve("xcsh://documentation/?search=x&language=en&language=fr")).rejects.toThrow(
			"Duplicate",
		);
	});

	it("returns exact verified Markdown", async () => {
		const result = await router().resolve(
			"xcsh://documentation/docs-cloud-f5-com/web-app-and-api-protection/index.md",
		);
		expect(result.content).toEndWith(markdown);
		expect(result.content).toStartWith("Cite: https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection");
		expect(result.contentType).toBe("text/markdown");
	});

	it("returns exact heading-bounded Markdown for anchored reads", async () => {
		const result = await router().resolve(
			"xcsh://documentation/docs-cloud-f5-com/web-app-and-api-protection/index.md#protect-applications",
		);
		expect(result.content).toEndWith("# Protect applications\n\nConfigure a load balancer.\n");
		expect(result.sourcePath).toEndWith("index.md#protect-applications");
	});

	it("returns base64 image resources", async () => {
		const result = await router().resolve(
			`xcsh://documentation/docs-cloud-f5-com/web-app-and-api-protection/assets/${"a".repeat(64)}.png`,
		);
		expect(result.contentType).toBe("image/png");
		expect(result.encoding).toBe("base64");
		expect(result.content).toBe(Buffer.from("png-bytes").toString("base64"));
	});

	it.each([
		"xcsh://documentation/?search=x&search=y",
		"xcsh://documentation/?search=x&unknown=y",
		"xcsh://documentation/?search=x&source=unknown",
		"xcsh://documentation/?search=x&limit=0",
		"xcsh://documentation/?search=x&limit=11",
		"xcsh://documentation/docs-cloud-f5-com/%2fetc/index.md",
		"xcsh://documentation/docs-cloud-f5-com/../secret/index.md",
		"xcsh://documentation/docs-cloud-f5-com/missing/index.md",
		"xcsh://documentation/www-f5-com/../company/index.md",
		"xcsh://documentation/www-f5-com/company/about-us/index.md",
		"xcsh://documentation/docs-cloud-f5-com/web-app-and-api-protection/index.md#%2fetc",
		"xcsh://documentation/docs-cloud-f5-com/web-app-and-api-protection/index.md#..",
	])("rejects invalid or unknown route %s", async value => {
		await expect(router().resolve(value)).rejects.toThrow();
	});
});

it("supports verified long heading anchors while rejecting oversized routes", async () => {
	const uri = "xcsh://documentation/my-f5-com/K000000001/index.md#";
	await expect(router().resolve(uri + "a".repeat(293))).resolves.toBeDefined();
	await expect(router().resolve(uri + "a".repeat(1025))).rejects.toThrow("Invalid documentation anchor");
});
