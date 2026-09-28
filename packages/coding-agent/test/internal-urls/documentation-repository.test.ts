import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGzip, gzipSync } from "node:zlib";
import tar from "tar-stream";
import { createEmbeddedDocumentationRepository } from "../../src/internal-urls/documentation-repository";
import {
	buildDocumentationIndex,
	type VerifiedDocumentationSnapshot,
} from "../../src/internal-urls/documentation-snapshot";

function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function tarGz(entries: ReadonlyMap<string, Buffer>): Promise<Buffer> {
	const pack = tar.pack();
	const gzip = createGzip({ level: 9 });
	const chunks: Buffer[] = [];
	const done = new Promise<Buffer>((resolve, reject) => {
		pack.pipe(gzip);
		gzip.on("data", chunk => chunks.push(Buffer.from(chunk)));
		gzip.on("error", reject);
		gzip.on("end", () => resolve(Buffer.concat(chunks)));
	});
	for (const [name, value] of entries) {
		await new Promise<void>((resolve, reject) => {
			pack.entry({ name, size: value.byteLength, mtime: new Date(0), uid: 0, gid: 0 }, value, error =>
				error ? reject(error) : resolve(),
			);
		});
	}
	pack.finalize();
	return done;
}

describe("embedded documentation repository", () => {
	let root: string;
	let cacheRoot: string;
	let rawIndexPath: string;
	let assets: Parameters<typeof createEmbeddedDocumentationRepository>[0];
	const docsCloudMarkdown =
		"---\ntitle: Protect Applications\n---\n\n# Protect Applications\n\nConfigure a web application firewall. Shared corpusmarker.\n";
	const myF5Markdown =
		"---\ntitle: Certificate Support\n---\n\n# Certificate Support\n\nTroubleshoot an expired certificate. Shared corpusmarker.\n";
	const marketingMarkdown =
		"---\ntitle: Client-Side Defense\n---\n\n# Client-Side Defense\n\nClient-Side Defense protects web applications from malicious scripts. Shared corpusmarker.\n";

	beforeAll(async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-documentation-repository-"));
		cacheRoot = path.join(root, "cache");
		const png = Buffer.from("png-image");
		const jpg = Buffer.from("jpeg-image");
		const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
		const webp = Buffer.from("webp-image");
		const documents = [
			{
				source: "docs-cloud-f5-com" as const,
				stablePath: "protect-applications",
				archivePath: "content/docs-cloud-f5-com/protect-applications/index.md",
				title: "Protect Applications",
				originalUrl: "https://docs.cloud.f5.com/docs-v2/protect-applications",
				bodySha256: sha256(
					"# Protect Applications\n\nConfigure a web application firewall. Shared corpusmarker.\n",
				),
				fileSha256: sha256(docsCloudMarkdown),
				sizeBytes: Buffer.byteLength(docsCloudMarkdown),
				markdown: docsCloudMarkdown,
			},
			{
				source: "my-f5-com" as const,
				stablePath: "K000000001",
				archivePath: "content/my-f5-com/K000000001/index.md",
				title: "Certificate Support",
				originalUrl: "https://my.f5.com/manage/s/article/K000000001",
				bodySha256: sha256("# Certificate Support\n\nTroubleshoot an expired certificate. Shared corpusmarker.\n"),
				fileSha256: sha256(myF5Markdown),
				sizeBytes: Buffer.byteLength(myF5Markdown),
				markdown: myF5Markdown,
			},
			{
				source: "www-f5-com" as const,
				stablePath: "products/distributed-cloud-services/client-side-defense",
				archivePath: "content/www-f5-com/products/distributed-cloud-services/client-side-defense/index.md",
				title: "Client-Side Defense",
				originalUrl: "https://www.f5.com/products/distributed-cloud-services/client-side-defense",
				bodySha256: sha256(
					"# Client-Side Defense\n\nClient-Side Defense protects web applications from malicious scripts. Shared corpusmarker.\n",
				),
				fileSha256: sha256(marketingMarkdown),
				sizeBytes: Buffer.byteLength(marketingMarkdown),
				markdown: marketingMarkdown,
			},
		];
		const assetRows = [
			{
				source: "docs-cloud-f5-com" as const,
				stablePath: "protect-applications",
				bytes: png,
				extension: "png",
				mimeType: "image/png" as const,
			},
			{
				source: "docs-cloud-f5-com" as const,
				stablePath: "protect-applications",
				bytes: jpg,
				extension: "jpg",
				mimeType: "image/jpeg" as const,
			},
			{
				source: "my-f5-com" as const,
				stablePath: "K000000001",
				bytes: svg,
				extension: "svg",
				mimeType: "image/svg+xml" as const,
			},
			{
				source: "www-f5-com" as const,
				stablePath: "products/distributed-cloud-services/client-side-defense",
				bytes: webp,
				extension: "webp",
				mimeType: "image/webp" as const,
			},
		];
		const snapshotAssets = assetRows.map(row => {
			const filename = `${sha256(row.bytes)}.${row.extension}`;
			return {
				source: row.source,
				stablePath: row.stablePath,
				filename,
				archivePath: `content/${row.source}/${row.stablePath}/assets/${filename}`,
				mimeType: row.mimeType,
				sha256: sha256(row.bytes),
				sizeBytes: row.bytes.byteLength,
			};
		});
		const archive = await tarGz(
			new Map(snapshotAssets.map((asset, index) => [asset.archivePath, assetRows[index]!.bytes])),
		);
		const archivePath = path.join(root, "documentation.tar.gz");
		rawIndexPath = path.join(root, "documentation.sqlite");
		const compressedIndexPath = path.join(root, "documentation.sqlite.gz");
		await writeFile(archivePath, archive);
		const snapshot: VerifiedDocumentationSnapshot = {
			archivePath,
			releaseTag: "content-20260926T214508Z",
			sourceCommit: "3".repeat(40),
			archiveSha256: sha256(archive),
			documents,
			assets: snapshotAssets,
		};
		const index = await buildDocumentationIndex(snapshot, rawIndexPath);
		const compressedIndex = gzipSync(await readFile(rawIndexPath), { level: 9 });
		await writeFile(compressedIndexPath, compressedIndex);
		assets = {
			archivePath,
			indexGzipPath: compressedIndexPath,
			indexGzipSha256: sha256(compressedIndex),
			indexGzipSizeBytes: compressedIndex.byteLength,
			releaseTag: snapshot.releaseTag,
			sourceCommit: snapshot.sourceCommit,
			archiveSha256: snapshot.archiveSha256,
			archiveSizeBytes: archive.byteLength,
			indexSha256: index.sha256,
			indexSizeBytes: index.sizeBytes,
			fingerprint: index.fingerprint,
			documentCount: documents.length,
			assetCount: snapshotAssets.length,
		};
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("searches all three collections with authoritative source filtering and exact reads", async () => {
		const repository = createEmbeddedDocumentationRepository(assets, { cacheRoot });
		const all = await repository.search("certificate", undefined, 5);
		expect(all[0]).toMatchObject({ source: "my-f5-com", stablePath: "K000000001" });
		expect(all[0]?.snippet.length).toBeLessThanOrEqual(600);
		const unfiltered = await repository.search("corpusmarker", undefined, 5);
		expect(new Set(unfiltered.map(result => result.source))).toEqual(
			new Set(["docs-cloud-f5-com", "my-f5-com", "www-f5-com"]),
		);
		const filtered = await repository.search("protect applications", "docs-cloud-f5-com", 1);
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.source).toBe("docs-cloud-f5-com");
		expect((await repository.readDocument("docs-cloud-f5-com", "protect-applications"))?.markdown).toBe(
			docsCloudMarkdown,
		);
		const marketing = await repository.search("what is client side defense", "www-f5-com", 1);
		expect(marketing[0]).toMatchObject({
			source: "www-f5-com",
			stablePath: "products/distributed-cloud-services/client-side-defense",
		});
		expect(
			(await repository.readDocument("www-f5-com", "products/distributed-cloud-services/client-side-defense"))
				?.markdown,
		).toBe(marketingMarkdown);
		const cachedIndex = path.join(cacheRoot, assets.fingerprint, "documentation-index.sqlite");
		expect(sha256(await readFile(cachedIndex))).toBe(assets.indexSha256);
	});

	it("streams only manifest assets and repairs corrupt cached files", async () => {
		const repository = createEmbeddedDocumentationRepository(assets, { cacheRoot });
		const db = new (await import("bun:sqlite")).Database(rawIndexPath, { readonly: true });
		const rows = db
			.query("SELECT source, stable_path, filename, mime_type FROM documentation_assets ORDER BY filename")
			.all() as Array<{
			source: "docs-cloud-f5-com" | "my-f5-com" | "www-f5-com";
			stable_path: string;
			filename: string;
			mime_type: "image/jpeg" | "image/png" | "image/svg+xml" | "image/webp";
		}>;
		db.close();
		for (const row of rows) {
			const first = await repository.readAsset(row.source, row.stable_path, row.filename);
			expect(first?.mimeType).toBe(row.mime_type);
			expect(first?.data).toBeTruthy();
		}
		const firstRow = rows[0]!;
		const cachedAsset = path.join(cacheRoot, assets.fingerprint, "assets", firstRow.filename);
		await mkdir(path.dirname(cachedAsset), { recursive: true });
		await writeFile(cachedAsset, "corrupt");
		const repaired = await createEmbeddedDocumentationRepository(assets, { cacheRoot }).readAsset(
			firstRow.source,
			firstRow.stable_path,
			firstRow.filename,
		);
		expect(repaired?.data).not.toBe(Buffer.from("corrupt").toString("base64"));
	});

	it("repairs a corrupt cached index and rejects stale embedded provenance", async () => {
		const cachedIndex = path.join(cacheRoot, assets.fingerprint, "documentation-index.sqlite");
		await mkdir(path.dirname(cachedIndex), { recursive: true });
		await writeFile(cachedIndex, "corrupt");
		const repaired = createEmbeddedDocumentationRepository(assets, { cacheRoot });
		expect(await repaired.readDocument("my-f5-com", "K000000001")).not.toBeNull();
		expect(sha256(await readFile(cachedIndex))).toBe(assets.indexSha256);

		const stale = createEmbeddedDocumentationRepository(
			{ ...assets, releaseTag: "content-20260926T214509Z" },
			{ cacheRoot: path.join(root, "stale") },
		);
		await expect(stale.search("certificate", undefined, 5)).rejects.toThrow("provenance");
	});
});
