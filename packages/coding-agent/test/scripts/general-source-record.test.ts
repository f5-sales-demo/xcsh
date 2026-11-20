import { expect, test } from "bun:test";
import type { CorpusSource } from "../../scripts/corpus-sources";
import { generalSourceRecord } from "../../scripts/refresh-corpus-sources";
import { sha256Bytes } from "../../src/internal-urls/documentation-snapshot";

function publication(tag: string) {
	const source: CorpusSource = {
		repository: "f5-sales-demo/html-to-markdown",
		tag,
		commit: "a".repeat(40),
		acceptance: "verified-bytes-mutable",
		assets: {},
	};
	const receipt = JSON.stringify({ schema_version: 1, release_tag: tag, source_commit: source.commit });
	const manifest = JSON.stringify({
		schema_version: 2,
		source_roots: { "community-f5-com": "", "docs-cloud-f5-com": "", "my-f5-com": "", "www-f5-com": "" },
		documents: [{ path: `content/${tag}/index.md`, file_sha256: "b".repeat(64) }],
		assets: [],
	});
	const files = { "publication.json": receipt, "manifest.json": manifest };
	for (const name of [
		"html-to-markdown-content.tar.gz",
		"html-to-markdown-content.tar.gz.sha256",
		"manifest.json",
		"publication.json",
		"quality-report.json",
		"quality-report.md",
	]) {
		const bytes = files[name as keyof typeof files] ?? "";
		source.assets[name] = { sha256: sha256Bytes(bytes), size_bytes: Buffer.byteLength(bytes) };
	}
	return { source, request: async (url: string) => new Response(files[url.split("/").at(-1) as keyof typeof files]) };
}

test("new general publication produces accurate source and text packaging metadata", async () => {
	const first = publication("content-20261017T100000Z");
	const next = publication("content-20261017T110000Z");
	const a = await generalSourceRecord(first.source, first.request);
	const b = await generalSourceRecord(next.source, next.request);
	expect(a.release_tag).toBe(first.source.tag);
	expect(b.release_tag).toBe(next.source.tag);
	expect(b.index.fingerprint).toBe("pending");
	expect(b.packaging?.text_manifest_sha256).not.toBe(a.packaging?.text_manifest_sha256);
	expect(b.packaging?.bundled_media_count).toBe(0);
});

test("published bytes must match discovery digests", async () => {
	const current = publication("content-20261017T110000Z");
	await expect(generalSourceRecord(current.source, async () => new Response("{}"))).rejects.toThrow("bytes mismatch");
});

test("receipt identity must match the discovered publication", async () => {
	const current = publication("content-20261017T110000Z");
	current.source.commit = "c".repeat(40);
	await expect(generalSourceRecord(current.source, current.request)).rejects.toThrow("identity mismatch");
});
