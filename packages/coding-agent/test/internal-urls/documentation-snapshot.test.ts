import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGzip } from "node:zlib";
import tar from "tar-stream";
import {
	buildDocumentationIndex,
	parseDocumentationReleasePin,
	verifyDocumentationRelease,
} from "../../src/internal-urls/documentation-snapshot";

function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

function document(source: string, title: string, slug: string, url: string, body: string): Buffer {
	const normalizedBody = `${body.trim()}\n`;
	return Buffer.from(
		[
			"---",
			`sourceId: ${source}`,
			`title: ${title}`,
			`slug: ${slug}`,
			`url: ${url}`,
			`content_hash: ${sha256(normalizedBody)}`,
			"---",
			"",
			normalizedBody,
		].join("\n"),
	);
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
	for (const [name, value] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
		await new Promise<void>((resolve, reject) => {
			pack.entry({ name, size: value.byteLength, mtime: new Date(0), uid: 0, gid: 0 }, value, error =>
				error ? reject(error) : resolve(),
			);
		});
	}
	pack.finalize();
	return done;
}

async function fixture(root: string, mutateManifest?: (value: Record<string, unknown>) => void) {
	const docsCloud = document(
		"docs-cloud-f5-com",
		"Protect Applications",
		"protect-applications",
		"https://docs.cloud.f5.com/docs-v2/protect-applications",
		"# Protect Applications\n\nConfigure a load balancer and web application firewall.",
	);
	const myF5 = document(
		"my-f5-com",
		"Support Article",
		"K000000001",
		"https://my.f5.com/manage/s/article/K000000001",
		"# Support Article\n\nTroubleshoot a certificate.",
	);
	const png = Buffer.from("png");
	const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
	const documents = [
		{
			sourceId: "docs-cloud-f5-com",
			url: "https://docs.cloud.f5.com/docs-v2/protect-applications",
			path: "content/docs-cloud-f5-com/protect-applications/index.md",
			body_sha256: sha256("# Protect Applications\n\nConfigure a load balancer and web application firewall.\n"),
			file_sha256: sha256(docsCloud),
			size_bytes: docsCloud.byteLength,
			provenance: {
				consecutive_failure_count: 0,
				current_failure: null,
				freshness: "fresh",
				last_success_at: "2026-09-26T21:00:00Z",
				terminal_confirmation_count: 0,
			},
		},
		{
			sourceId: "my-f5-com",
			url: "https://my.f5.com/manage/s/article/K000000001",
			path: "content/my-f5-com/K000000001/index.md",
			body_sha256: sha256("# Support Article\n\nTroubleshoot a certificate.\n"),
			file_sha256: sha256(myF5),
			size_bytes: myF5.byteLength,
			provenance: {
				consecutive_failure_count: 0,
				current_failure: null,
				freshness: "fresh",
				last_success_at: "2026-09-26T21:00:00Z",
				terminal_confirmation_count: 0,
			},
		},
	];
	const assets = [
		{
			path: `content/docs-cloud-f5-com/protect-applications/assets/${sha256(png)}.png`,
			sha256: sha256(png),
			media_type: "image/png",
			size_bytes: png.byteLength,
		},
		{
			path: `content/my-f5-com/K000000001/assets/${sha256(svg)}.svg`,
			sha256: sha256(svg),
			media_type: "image/svg+xml",
			size_bytes: svg.byteLength,
		},
	];
	const manifestValue: Record<string, unknown> = {
		schema_version: 2,
		tool_version: "0.1.0",
		source_roots: {
			"docs-cloud-f5-com": "https://docs.cloud.f5.com/docs-v2",
			"my-f5-com": "https://my.f5.com/manage/s",
		},
		started_at: "2026-09-26T21:00:00Z",
		ended_at: "2026-09-26T21:01:00Z",
		page_count: documents.length,
		asset_count: assets.length,
		documents,
		assets,
		counts: { fresh: 2 },
		quality_status_counts: { passed: 2 },
		removals: [],
		failures: [],
	};
	mutateManifest?.(manifestValue);
	const manifest = Buffer.from(`${JSON.stringify(manifestValue)}\n`);
	const qualityJson = Buffer.from("{}\n");
	const qualityMd = Buffer.from("# Quality\n");
	const payload = new Map<string, Buffer>([
		[documents[0]!.path, docsCloud],
		[documents[1]!.path, myF5],
		[assets[0]!.path, png],
		[assets[1]!.path, svg],
		["manifest.json", manifest],
		["quality-report.json", qualityJson],
		["quality-report.md", qualityMd],
	]);
	const sums = Buffer.from(
		[...payload]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([name, value]) => `${sha256(value)}  ${name}\n`)
			.join(""),
	);
	payload.set("SHA256SUMS", sums);
	const archive = await tarGz(payload);
	await mkdir(root, { recursive: true });
	await writeFile(path.join(root, "html-to-markdown-content.tar.gz"), archive);
	await writeFile(
		path.join(root, "html-to-markdown-content.tar.gz.sha256"),
		`${sha256(archive)}  html-to-markdown-content.tar.gz\n`,
	);
	await writeFile(path.join(root, "manifest.json"), manifest);
	await writeFile(path.join(root, "quality-report.json"), qualityJson);
	await writeFile(path.join(root, "quality-report.md"), qualityMd);
	const assetFiles = [
		"html-to-markdown-content.tar.gz",
		"html-to-markdown-content.tar.gz.sha256",
		"manifest.json",
		"quality-report.json",
		"quality-report.md",
	];
	const publication = {
		schema_version: 1,
		release_tag: "content-20260926T214508Z",
		source_commit: "3".repeat(40),
		created_at: "2026-09-26T21:44:59Z",
		published_at: "2026-09-26T21:45:08Z",
		assets: await Promise.all(
			assetFiles.map(async name => {
				const value = await readFile(path.join(root, name));
				return { name, sha256: sha256(value), size_bytes: value.byteLength };
			}),
		),
	};
	const publicationBytes = Buffer.from(`${JSON.stringify(publication)}\n`);
	await writeFile(path.join(root, "publication.json"), publicationBytes);
	const allAssets = [
		...publication.assets,
		{ name: "publication.json", sha256: sha256(publicationBytes), size_bytes: publicationBytes.byteLength },
	];
	return {
		pin: {
			schema_version: 1,
			source_repository: "f5-sales-demo/html-to-markdown",
			release_tag: publication.release_tag,
			source_commit: publication.source_commit,
			receipt_sha256: sha256(publicationBytes),
			assets: Object.fromEntries(
				allAssets.map(asset => [asset.name, { sha256: asset.sha256, size_bytes: asset.size_bytes }]),
			),
			manifest: {
				schema_version: 2,
				document_count: 2,
				asset_count: 2,
				source_roots: Object.keys(JSON.parse(manifest.toString()).source_roots),
			},
			index: { qmd_version: "2.8.3", fingerprint: "pending", sha256: "pending", size_bytes: 0 },
		},
		archivePath: path.join(root, "html-to-markdown-content.tar.gz"),
	};
}

describe("offline documentation release", () => {
	let root: string;
	afterEach(async () => {
		if (root) await rm(root, { recursive: true, force: true });
	});

	it("rejects augmented pins and release directories", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const { pin } = await fixture(root);
		expect(() => parseDocumentationReleasePin({ ...pin, latest: true })).toThrow("invalid shape");
		await writeFile(path.join(root, "unexpected.txt"), "nope");
		await expect(verifyDocumentationRelease(root, pin)).rejects.toThrow("asset set mismatch");
	});

	it("rejects augmented nested manifest records", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const { pin } = await fixture(root, value => {
			const documents = value.documents as Array<Record<string, unknown>>;
			documents[0]!.unexpected = true;
		});
		await expect(verifyDocumentationRelease(root, pin)).rejects.toThrow("manifest document 0 has an invalid shape");
	});

	it("rejects array-shaped document failure provenance", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const { pin } = await fixture(root, value => {
			const documents = value.documents as Array<Record<string, unknown>>;
			const provenance = documents[0]!.provenance as Record<string, unknown>;
			provenance.current_failure = [];
		});
		await expect(verifyDocumentationRelease(root, pin)).rejects.toThrow(
			"manifest document 0.current_failure is invalid",
		);
	});

	it("verifies every archive member and generates byte-identical two-collection indexes", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const { pin } = await fixture(root);
		const verified = await verifyDocumentationRelease(root, pin);
		expect(verified.documents).toHaveLength(2);
		expect(verified.assets).toHaveLength(2);

		const first = path.join(root, "first.sqlite");
		const second = path.join(root, "second.sqlite");
		const firstResult = await buildDocumentationIndex(verified, first);
		const secondResult = await buildDocumentationIndex(verified, second);
		expect(firstResult).toEqual(secondResult);
		expect(await readFile(first)).toEqual(await readFile(second));

		const db = new Database(first, { readonly: true });
		try {
			const collections = db.query("SELECT name FROM store_collections ORDER BY name").all() as Array<{
				name: string;
			}>;
			expect(collections.map(row => row.name)).toEqual(["docs-cloud-f5-com", "my-f5-com"]);
			const rows = db
				.query("SELECT markdown, file_sha256 FROM documentation_documents ORDER BY source")
				.all() as Array<{ markdown: string; file_sha256: string }>;
			expect(rows).toHaveLength(2);
			expect(rows.every(row => sha256(row.markdown) === row.file_sha256)).toBe(true);
		} finally {
			db.close();
		}
	});
});
