import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGzip, gzipSync } from "node:zlib";
import tar from "tar-stream";
import { type DocumentationMetadata, splitHeadingPassages } from "../../src/internal-urls/documentation-metadata";
import { createEmbeddedDocumentationRepository } from "../../src/internal-urls/documentation-repository";
import {
	buildDocumentationIndex,
	type VerifiedDocumentationSnapshot,
} from "../../src/internal-urls/documentation-snapshot";

function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

function fixtureMetadata(
	source: "docs-cloud-f5-com" | "my-f5-com" | "www-f5-com",
	canonicalUrl: string,
	lifecycle: "current" | "deprecated" | "superseded" = source === "my-f5-com" ? "deprecated" : "current",
	replacementUrl: string | null = null,
): DocumentationMetadata {
	const marketing = source === "www-f5-com";
	const support = source === "my-f5-com";
	return {
		metadataSchema: 1,
		product: marketing ? "client-side-defense" : null,
		contentType: marketing ? "product_overview" : support ? "knowledge_article" : "how_to",
		taskType: marketing ? "concept" : support ? "support" : "configure",
		canonicalUrl,
		lastUpdated: "2026-09-26",
		language: "en",
		aliases: marketing ? ["Client-Side Defense", "CSD"] : [],
		lifecycle,
		replacementUrl,
		relatedDocuments: marketing
			? [
					{
						relation: "configure",
						title: "Protect Applications",
						canonicalUrl: "https://docs.cloud.f5.com/docs-v2/protect-applications",
						source: "docs-cloud-f5-com",
						stablePath: "protect-applications",
					},
				]
			: [],
	};
}

function passages(markdown: string) {
	return splitHeadingPassages(markdown.replace(/^---\n.*?\n---\n\n?/s, ""));
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
				metadata: fixtureMetadata("docs-cloud-f5-com", "https://docs.cloud.f5.com/docs-v2/protect-applications"),
				passages: passages(docsCloudMarkdown),
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
				metadata: fixtureMetadata("my-f5-com", "https://my.f5.com/manage/s/article/K000000001"),
				passages: passages(myF5Markdown),
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
				metadata: fixtureMetadata(
					"www-f5-com",
					"https://www.f5.com/products/distributed-cloud-services/client-side-defense",
				),
				passages: passages(marketingMarkdown),
			},
			...(["current", "deprecated", "superseded"] as const).map(lifecycle => {
				const stablePath = `lifecycle-${lifecycle}`;
				const originalUrl = `https://docs.cloud.f5.com/docs-v2/${stablePath}`;
				const markdown = `---\ntitle: ${lifecycle} lifecycle\n---\n\n# ${lifecycle} lifecycle\n\nUnique lifecyclerank content.\n`;
				return {
					source: "docs-cloud-f5-com" as const,
					stablePath,
					archivePath: `content/docs-cloud-f5-com/${stablePath}/index.md`,
					title: `${lifecycle} lifecycle`,
					originalUrl,
					bodySha256: sha256(`# ${lifecycle} lifecycle\n\nUnique lifecyclerank content.\n`),
					fileSha256: sha256(markdown),
					sizeBytes: Buffer.byteLength(markdown),
					markdown,
					metadata: fixtureMetadata(
						"docs-cloud-f5-com",
						originalUrl,
						lifecycle,
						lifecycle === "superseded" ? "https://docs.cloud.f5.com/docs-v2/lifecycle-current" : null,
					),
					passages: passages(markdown),
				};
			}),
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
			aliases: [
				{
					path: "content/docs-cloud-f5-com/old/index.md",
					target: "content/docs-cloud-f5-com/protect-applications/index.md",
					url: "https://docs.cloud.f5.com/docs-v2/old",
				},
			],
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

	it("resolves aliases to canonical text, headings and existing media only", async () => {
		const repository = createEmbeddedDocumentationRepository(assets, { cacheRoot });
		const canonical = await repository.readDocument("docs-cloud-f5-com", "protect-applications");
		expect(await repository.readDocument("docs-cloud-f5-com", "old")).toEqual(canonical);
		expect((await repository.readDocument("docs-cloud-f5-com", "old", "protect-applications"))?.originalUrl).toBe(
			canonical?.originalUrl,
		);
		expect(await repository.readDocument("docs-cloud-f5-com", "old", "removed-heading")).toBeNull();
		expect(await repository.readAsset("docs-cloud-f5-com", "old", "removed.png")).toBeNull();
		const { Database } = await import("bun:sqlite");
		const db = new Database(rawIndexPath, { readonly: true });
		try {
			const row = db
				.query(
					"SELECT filename FROM documentation_assets WHERE source = 'docs-cloud-f5-com' AND stable_path = 'protect-applications' LIMIT 1",
				)
				.get() as { filename: string };
			expect(await repository.readAsset("docs-cloud-f5-com", "old", row.filename)).toEqual(
				await repository.readAsset("docs-cloud-f5-com", "protect-applications", row.filename),
			);
		} finally {
			db.close();
		}
		expect((await repository.search("corpusmarker", "docs-cloud-f5-com", 5)).map(r => r.stablePath)).not.toContain(
			"old",
		);
	});

	it("searches all three collections with authoritative source filtering and exact reads", async () => {
		const indexDatabase = new (await import("bun:sqlite")).Database(rawIndexPath, { readonly: true });
		try {
			expect(
				(indexDatabase.query("SELECT count(*) AS count FROM documentation_passages").get() as { count: number })
					.count,
			).toBe(6);
			expect(indexDatabase.query("SELECT alias FROM documentation_aliases ORDER BY alias").all()).toEqual([
				{ alias: "CSD" },
				{ alias: "Client-Side Defense" },
			]);
			expect(
				(
					indexDatabase.query("SELECT count(*) AS count FROM documentation_relationships").get() as {
						count: number;
					}
				).count,
			).toBe(1);
		} finally {
			indexDatabase.close();
		}
		const repository = createEmbeddedDocumentationRepository(assets, { cacheRoot });
		const all = await repository.search("certificate", undefined, 5);
		expect(all[0]).toMatchObject({ source: "my-f5-com", stablePath: "K000000001" });
		expect(all[0]?.snippet.length).toBeLessThanOrEqual(600);
		const unfiltered = await repository.search("corpusmarker", undefined, 5);
		expect(new Set(unfiltered.map(result => result.source))).toEqual(
			new Set(["docs-cloud-f5-com", "my-f5-com", "www-f5-com"]),
		);
		expect(unfiltered.find(result => result.source === "my-f5-com")!.score).toBeLessThan(
			unfiltered.find(result => result.source === "docs-cloud-f5-com")!.score,
		);
		expect((await repository.search("what is client side defense", undefined, 5))[0]).toMatchObject({
			source: "www-f5-com",
			stablePath: "products/distributed-cloud-services/client-side-defense",
		});
		expect((await repository.search("configure web application firewall", undefined, 5))[0]).toMatchObject({
			source: "docs-cloud-f5-com",
			stablePath: "protect-applications",
		});
		expect((await repository.search("troubleshoot expired certificate", undefined, 5))[0]).toMatchObject({
			source: "my-f5-com",
			stablePath: "K000000001",
		});
		const filtered = await repository.search("protect applications", "docs-cloud-f5-com", 1);
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.source).toBe("docs-cloud-f5-com");
		expect(filtered[0]?.anchor).toBe("protect-applications");
		expect(filtered[0]?.contentType).toBe("how_to");
		expect(
			await repository.search("protect applications", undefined, 5, {
				product: "dns",
			}),
		).toEqual([]);
		expect(await repository.search("CSD", undefined, 5)).toMatchObject([
			{
				aliases: ["Client-Side Defense", "CSD"],
				canonicalUrl: "https://www.f5.com/products/distributed-cloud-services/client-side-defense",
				lastUpdated: "2026-09-26",
				product: "client-side-defense",
				source: "www-f5-com",
			},
		]);
		expect(
			await repository.search("corpusmarker", undefined, 5, {
				contentType: "knowledge_article",
				taskType: "support",
				language: "en",
				lifecycle: "deprecated",
			}),
		).toMatchObject([{ source: "my-f5-com", lifecycle: "deprecated" }]);
		expect(
			await repository.search("corpusmarker", "docs-cloud-f5-com", 5, {
				product: "client-side-defense",
			}),
		).toEqual([]);
		const lifecycle = await repository.search("lifecyclerank", undefined, 5);
		expect(lifecycle.map(result => result.lifecycle)).toEqual(["current", "deprecated", "superseded"]);
		expect(lifecycle[0]!.score).toBeGreaterThan(lifecycle[1]!.score);
		expect(lifecycle[1]!.score).toBeGreaterThan(lifecycle[2]!.score);
		expect((await repository.readDocument("docs-cloud-f5-com", "protect-applications"))?.markdown).toBe(
			docsCloudMarkdown,
		);
		expect(
			(await repository.readDocument("docs-cloud-f5-com", "protect-applications", "protect-applications"))?.markdown,
		).toBe("# Protect Applications\n\nConfigure a web application firewall. Shared corpusmarker.\n");
		expect(await repository.readDocument("docs-cloud-f5-com", "protect-applications", "missing-anchor")).toBeNull();
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
			expect(first && "data" in first ? first.data : null).toBeTruthy();
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
		expect(repaired && "data" in repaired ? repaired.data : null).not.toBe(Buffer.from("corrupt").toString("base64"));
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
