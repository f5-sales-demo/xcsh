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
		async search(query, source, limit) {
			expect(query).toBe("protect applications");
			expect(limit).toBe(source === undefined ? 5 : 1);
			const rows = [
				{
					title: "Protect applications",
					source: "docs-cloud-f5-com" as const,
					originalUrl: "https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection",
					stablePath: "web-app-and-api-protection",
					snippet: "Configure a load balancer.",
					score: 7.25,
				},
				{
					title: "Support article",
					source: "my-f5-com" as const,
					originalUrl: "https://my.f5.com/manage/s/article/K000000001",
					stablePath: "K000000001",
					snippet: "Support content.",
					score: 4.5,
				},
			];
			return rows.filter(row => source === undefined || row.source === source).slice(0, limit);
		},
		async readDocument(source, stablePath) {
			return source === "docs-cloud-f5-com" && stablePath === "web-app-and-api-protection"
				? {
						markdown,
						title: "Protect applications",
						originalUrl: "https://docs.cloud.f5.com/docs-v2/web-app-and-api-protection",
					}
				: null;
		},
		async readAsset(source, stablePath, filename) {
			return source === "docs-cloud-f5-com" &&
				stablePath === "web-app-and-api-protection" &&
				filename === `${"a".repeat(64)}.png`
				? { data: Buffer.from("png-bytes").toString("base64"), mimeType: "image/png" }
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
	});

	it("searches both sources with five results by default and exact follow-up URLs", async () => {
		const result = await router().resolve("xcsh://documentation/?search=protect%20applications");
		expect(result.content).toContain("Protect applications");
		expect(result.content).toContain("xcsh://documentation/docs-cloud-f5-com/web-app-and-api-protection/index.md");
		expect(result.content).toContain("Snapshot: `content-20260926T214508Z`");
	});

	it("supports source filtering and limits 1 through 10", async () => {
		const result = await router().resolve(
			"xcsh://documentation/?search=protect%20applications&source=my-f5-com&limit=1",
		);
		expect(result.content).toContain("Support article");
		expect(result.content).not.toContain("Protect applications");
	});

	it("returns exact verified Markdown", async () => {
		const result = await router().resolve(
			"xcsh://documentation/docs-cloud-f5-com/web-app-and-api-protection/index.md",
		);
		expect(result.content).toBe(markdown);
		expect(result.contentType).toBe("text/markdown");
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
	])("rejects invalid or unknown route %s", async value => {
		await expect(router().resolve(value)).rejects.toThrow();
	});
});
