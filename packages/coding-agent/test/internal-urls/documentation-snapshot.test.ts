import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGzip, gzipSync } from "node:zlib";
import tar from "tar-stream";
import {
	buildDocumentationIndex,
	parseDocumentationReleasePin,
	verifyDocumentationRelease,
	verifyPrebuiltDocumentationAssets,
} from "../../src/internal-urls/documentation-snapshot";

function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

function document(source: string, title: string, slug: string, url: string, body: string): Buffer {
	const normalizedBody = `${body.trim()}\n`;
	const marketing = source === "www-f5-com";
	const support = source === "my-f5-com" || source === "community-f5-com";
	const product = title === "Client-Side Defense" ? "client-side-defense" : null;
	return Buffer.from(
		[
			"---",
			"metadata_schema: 1",
			`sourceId: ${source}`,
			`title: ${title}`,
			`slug: ${slug}`,
			`url: ${url}`,
			`content_hash: ${sha256(normalizedBody)}`,
			`product: ${product ?? "null"}`,
			`content_type: ${marketing ? "product_overview" : support ? "knowledge_article" : "how_to"}`,
			`task_type: ${marketing ? "concept" : support ? "support" : "configure"}`,
			`canonical_url: ${url}`,
			"last_updated: '2026-09-26'",
			"language: en",
			...(product ? ["aliases:", "- Client-Side Defense", "- CSD"] : ["aliases: []"]),
			"lifecycle: current",
			"replacement_url: null",
			"related_documents: []",
			"---",
			"",
			normalizedBody,
		].join("\n"),
	);
}

async function tarGz(entries: Iterable<readonly [string, Buffer]>): Promise<Buffer> {
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

const MARKETING_PAGES = [
	[
		"Client-Side Defense",
		"products/distributed-cloud-services/client-side-defense",
		"https://www.f5.com/products/distributed-cloud-services/client-side-defense",
	],
	[
		"Hybrid Multicloud Application Delivery",
		"solutions/use-cases/hybrid-multicloud-application-delivery",
		"https://www.f5.com/solutions/use-cases/hybrid-multicloud-application-delivery",
	],
	[
		"Multi-Cloud Networking",
		"solutions/use-cases/multi-cloud-networking",
		"https://www.f5.com/solutions/use-cases/multi-cloud-networking",
	],
	[
		"Web App and API Protection",
		"solutions/web-app-and-api-protection",
		"https://www.f5.com/solutions/web-app-and-api-protection",
	],
] as const;

async function fixture(
	root: string,
	mutateManifest?: (value: Record<string, unknown>) => void,
	mutateMembers?: (members: Array<readonly [string, Buffer]>) => void,
) {
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
	const community = document(
		"community-f5-com",
		"Community Walkthrough",
		"65170",
		"https://community.f5.com/t/65170",
		"# Community Walkthrough\n\nTroubleshoot an API discovery example.",
	);
	const marketing = MARKETING_PAGES.map(([title, slug, url]) =>
		document("www-f5-com", title, slug, url, `# ${title}\n\nDiscover F5 Distributed Cloud products and solutions.`),
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
		...MARKETING_PAGES.map(([title, slug, url], index) => ({
			sourceId: "www-f5-com",
			url,
			path: `content/www-f5-com/${slug}/index.md`,
			body_sha256: sha256(`# ${title}\n\nDiscover F5 Distributed Cloud products and solutions.\n`),
			file_sha256: sha256(marketing[index]!),
			size_bytes: marketing[index]!.byteLength,
			provenance: {
				consecutive_failure_count: 0,
				current_failure: null,
				freshness: "fresh",
				last_success_at: "2026-09-26T21:00:00Z",
				terminal_confirmation_count: 0,
			},
		})),
		{
			sourceId: "community-f5-com",
			url: "https://community.f5.com/t/65170",
			path: "content/community-f5-com/t/65170/index.md",
			body_sha256: sha256("# Community Walkthrough\n\nTroubleshoot an API discovery example.\n"),
			file_sha256: sha256(community),
			size_bytes: community.byteLength,
			provenance: {
				consecutive_failure_count: 0,
				current_failure: null,
				freshness: "fresh",
				last_success_at: "2026-09-26T21:00:00Z",
				terminal_confirmation_count: 0,
			},
		},
	];
	const webp = Buffer.from("webp");
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
		{
			path: `content/www-f5-com/products/distributed-cloud-services/client-side-defense/assets/${sha256(webp)}.webp`,
			sha256: sha256(webp),
			media_type: "image/webp",
			size_bytes: webp.byteLength,
		},
	];
	const manifestValue: Record<string, unknown> = {
		schema_version: 2,
		tool_version: "0.1.0",
		source_roots: {
			"community-f5-com": "https://community.f5.com",
			"docs-cloud-f5-com": "https://docs.cloud.f5.com/docs-v2",
			"my-f5-com": "https://my.f5.com/manage/s",
			"www-f5-com": "https://www.f5.com/products/distributed-cloud-services",
		},
		started_at: "2026-09-26T21:00:00Z",
		ended_at: "2026-09-26T21:01:00Z",
		page_count: documents.length,
		asset_count: assets.length,
		documents,
		assets,
		counts: { fresh: documents.length },
		quality_status_counts: { passed: documents.length },
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
		...marketing.map((bytes, index) => [documents[index + 2]!.path as string, bytes] as const),
		["content/community-f5-com/t/65170/index.md", community],
		[assets[0]!.path, png],
		[assets[1]!.path, svg],
		[assets[2]!.path, webp],
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
	const members = [...payload];
	mutateMembers?.(members);
	const archive = await tarGz(members);
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
				document_count: documents.length,
				asset_count: assets.length,
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

	it.each([
		"../escape",
		"/absolute",
		"content/docs-cloud-f5-com/../escape/index.md",
		"content/docs-cloud-f5-com/%2e%2e/index.md",
	])("rejects unsafe archive member %s with valid outer receipts", async name => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const { pin } = await fixture(root, undefined, members => members.push([name, Buffer.from("bad")]));
		await expect(verifyDocumentationRelease(root, pin)).rejects.toThrow();
	});
	it("rejects duplicate archive members even when the outer archive is correctly attested", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const { pin } = await fixture(root, undefined, members => members.push(members[0]!));
		await expect(verifyDocumentationRelease(root, pin)).rejects.toThrow("duplicate member");
	});
	it("rejects a corrupt receipt and an attested receipt with the wrong source commit", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const { pin } = await fixture(root);
		const receiptPath = path.join(root, "publication.json");
		const original = await readFile(receiptPath);
		await writeFile(receiptPath, Buffer.alloc(original.length));
		await expect(verifyDocumentationRelease(root, pin)).rejects.toThrow("asset digest mismatch");
		const receipt = JSON.parse(original.toString());
		receipt.source_commit = "4".repeat(40);
		const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`);
		await writeFile(receiptPath, bytes);
		pin.receipt_sha256 = sha256(bytes);
		pin.assets["publication.json"] = { sha256: sha256(bytes), size_bytes: bytes.length };
		await expect(verifyDocumentationRelease(root, pin)).rejects.toThrow("publication identity mismatch");
	});
	it("rejects a malformed gzip archive with a valid asset and publication envelope", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const { pin } = await fixture(root);
		const bytes = Buffer.from("not a gzip stream");
		await writeFile(path.join(root, "html-to-markdown-content.tar.gz"), bytes);
		await writeFile(
			path.join(root, "html-to-markdown-content.tar.gz.sha256"),
			`${sha256(bytes)}  html-to-markdown-content.tar.gz\n`,
		);
		for (const name of ["html-to-markdown-content.tar.gz", "html-to-markdown-content.tar.gz.sha256"]) {
			const value = await readFile(path.join(root, name));
			pin.assets[name] = { sha256: sha256(value), size_bytes: value.length };
		}
		const receipt = JSON.parse(await readFile(path.join(root, "publication.json"), "utf8"));
		for (const asset of receipt.assets) Object.assign(asset, pin.assets[asset.name]);
		const publication = Buffer.from(`${JSON.stringify(receipt)}\n`);
		await writeFile(path.join(root, "publication.json"), publication);
		pin.assets["publication.json"] = { sha256: sha256(publication), size_bytes: publication.length };
		pin.receipt_sha256 = sha256(publication);
		await expect(verifyDocumentationRelease(root, pin)).rejects.toThrow();
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

	it("verifies every archive member and generates byte-identical four-collection indexes", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const { pin } = await fixture(root);
		const verified = await verifyDocumentationRelease(root, pin);
		expect(verified.documents).toHaveLength(7);
		expect(verified.assets).toHaveLength(3);
		expect(verified.documents.filter(item => item.source === "www-f5-com").map(item => item.originalUrl)).toEqual(
			MARKETING_PAGES.map(([, , url]) => url),
		);

		const first = path.join(root, "first.sqlite");
		const second = path.join(root, "second.sqlite");
		const firstResult = await buildDocumentationIndex(verified, first);
		const secondResult = await buildDocumentationIndex(verified, second);
		expect(firstResult).toEqual(secondResult);
		const firstBytes = await readFile(first);
		expect(firstBytes).toEqual(await readFile(second));
		// SQLite mutates these header fields according to the connection's write
		// history. Pinning both values makes identical logical databases portable
		// across the Linux and macOS release builders.
		expect(firstBytes.readUInt32BE(24)).toBe(1);
		expect(firstBytes.readUInt32BE(92)).toBe(1);
		expect(firstBytes.readUInt32BE(96)).toBe(3_000_000);

		const db = new Database(first, { readonly: true });
		try {
			const collections = db.query("SELECT name FROM store_collections ORDER BY name").all() as Array<{
				name: string;
			}>;
			expect(collections.map(row => row.name)).toEqual([
				"community-f5-com",
				"docs-cloud-f5-com",
				"my-f5-com",
				"www-f5-com",
			]);
			const rows = db
				.query("SELECT markdown, file_sha256 FROM documentation_documents ORDER BY source")
				.all() as Array<{ markdown: string; file_sha256: string }>;
			expect(rows).toHaveLength(7);
			expect(rows.every(row => sha256(row.markdown) === row.file_sha256)).toBe(true);
		} finally {
			db.close();
		}
	});

	it("rejects www.f5.com pages outside the reviewed marketing allowlist", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const { pin } = await fixture(root, value => {
			const documents = value.documents as Array<Record<string, unknown>>;
			documents[2]!.url = "https://www.f5.com/company/about-us";
		});
		await expect(verifyDocumentationRelease(root, pin)).rejects.toThrow("outside the declared source root");
	});

	it("binds reviewed marketing URLs and assets to their exact stable paths", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const mismatchedDocument = await fixture(root, value => {
			const documents = value.documents as Array<Record<string, unknown>>;
			documents[2]!.path = "content/www-f5-com/company/about-us/index.md";
		});
		await expect(verifyDocumentationRelease(root, mismatchedDocument.pin)).rejects.toThrow(
			"marketing document path does not match its reviewed URL",
		);

		await rm(root, { recursive: true, force: true });
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const unattachedAsset = await fixture(root, value => {
			const assets = value.assets as Array<Record<string, unknown>>;
			assets[2]!.path = `content/www-f5-com/company/about-us/assets/${sha256("webp")}.webp`;
		});
		await expect(verifyDocumentationRelease(root, unattachedAsset.pin)).rejects.toThrow(
			"marketing asset is not attached to a reviewed document",
		);
	});

	it("accepts only prebuilt archive and index bytes that match the complete pin", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "xcsh-doc-release-"));
		const { pin, archivePath } = await fixture(root);
		const verified = await verifyDocumentationRelease(root, pin);
		const indexPath = path.join(root, "index.sqlite");
		const index = await buildDocumentationIndex(verified, indexPath);
		const completePin = parseDocumentationReleasePin({
			...pin,
			index: {
				qmd_version: "2.8.3",
				fingerprint: index.fingerprint,
				sha256: index.sha256,
				size_bytes: index.sizeBytes,
			},
		});
		const generated = path.join(root, "generated");
		await mkdir(generated);
		await copyFile(archivePath, path.join(generated, "html-to-markdown-content.tar.gz"));
		const compressed = gzipSync(await readFile(indexPath), { level: 9 });
		await writeFile(path.join(generated, "documentation-index.sqlite.gz"), compressed);

		const accepted = await verifyPrebuiltDocumentationAssets(generated, completePin);
		expect(accepted.indexGzip).toEqual(compressed);

		await writeFile(path.join(generated, "html-to-markdown-content.tar.gz"), Buffer.from("corrupt"));
		await expect(verifyPrebuiltDocumentationAssets(generated, completePin)).rejects.toThrow(
			"prebuilt documentation archive disagrees with pin",
		);
		await copyFile(archivePath, path.join(generated, "html-to-markdown-content.tar.gz"));
		await writeFile(path.join(generated, "documentation-index.sqlite.gz"), gzipSync(Buffer.from("wrong")));
		await expect(verifyPrebuiltDocumentationAssets(generated, completePin)).rejects.toThrow(
			"prebuilt documentation index disagrees with pin",
		);
		await writeFile(path.join(generated, "documentation-index.sqlite.gz"), Buffer.from("corrupt"));
		await expect(verifyPrebuiltDocumentationAssets(generated, completePin)).rejects.toThrow(
			"prebuilt documentation index is not valid bounded gzip",
		);
	});
});
