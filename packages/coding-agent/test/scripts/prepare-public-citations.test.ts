import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { CorpusSource, CorpusSources } from "../../scripts/corpus-sources";
import { preparePublicCitations } from "../../scripts/prepare-public-citations";

const content = new TextEncoder().encode("{}");
const asset = { sha256: createHash("sha256").update(content).digest("hex"), size_bytes: content.length };
function source(repository: string, tag: string, names: string[]): CorpusSource {
	return {
		repository,
		tag,
		commit: "a".repeat(40),
		acceptance: "immutable",
		assets: Object.fromEntries(names.map(n => [n, asset])),
	};
}
const sources: CorpusSources = {
	general: source("f5-sales-demo/html-to-markdown", "content-20260101T000000Z", [
		"manifest.json",
		"html-to-markdown-content.tar.gz",
	]),
	terraform: source("f5-sales-demo/terraform-provider-xcsh", "documentation-v1.0.0", [
		"manifest.json",
		"canonical-documentation.tar.gz",
	]),
	provider: source("f5-sales-demo/terraform-provider-xcsh", "v1.0.0", ["provider.zip"]),
	api: source("f5-sales-demo/api-specs-enriched", "v1.0.0", ["api-catalog.json", "f5xc-api-specs-v1.0.0.zip"]),
};
const request = async (url: string) => new Response(url.endsWith(".xml") ? "<urlset/>" : content);
test("materializes verified current receipts and files for the existing generator", async () => {
	let staged = "";
	await preparePublicCitations({
		resolve: async () => sources,
		request,
		run: async root => {
			staged = root;
			const receipt = JSON.parse(await readFile(path.join(root, "assessment/source-receipts.json"), "utf8"));
			expect(receipt.content.tag).toBe(sources.general.tag);
			expect(receipt.provider.assets["canonical-documentation.tar.gz"].sha256).toBe(asset.sha256);
			expect(new Uint8Array(await readFile(path.join(root, "sources/api/f5xc-api-specs-v1.0.0.zip")))).toEqual(
				content,
			);
		},
	});
	await expect(stat(staged)).rejects.toThrow();
});
test("generator failure cleans up its owned staging directory", async () => {
	let staged = "";
	await expect(
		preparePublicCitations({
			resolve: async () => sources,
			request,
			run: async root => {
				staged = root;
				throw new Error("unpublished mapping");
			},
		}),
	).rejects.toThrow("unpublished mapping");
	await expect(stat(staged)).rejects.toThrow();
});
test("forged downloaded manifests prevent the generator from running", async () => {
	let called = false;
	await expect(
		preparePublicCitations({
			resolve: async () => sources,
			request: async () => new Response("corrupt"),
			run: async () => {
				called = true;
			},
		}),
	).rejects.toThrow("bytes mismatch");
	expect(called).toBe(false);
});
test("unavailable public sitemap prevents successful citation generation", async () => {
	let called = false;
	await expect(
		preparePublicCitations({
			resolve: async () => sources,
			request: async url => (url.endsWith(".xml") ? new Response("", { status: 503 }) : request(url)),
			run: async () => {
				called = true;
			},
		}),
	).rejects.toThrow("HTTP 503");
	expect(called).toBe(false);
});
