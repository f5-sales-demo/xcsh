import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createStore } from "@tobilu/qmd";
import type {
	DocumentationAsset,
	DocumentationDocument,
	DocumentationRepository,
	DocumentationSearchResult,
	DocumentationSource,
} from "./documentation-resolve";
import { extractVerifiedDocumentationAsset, type VerifiedDocumentationAsset } from "./documentation-snapshot";

interface EmbeddedDocumentationAssetMetadata {
	readonly archivePath: string;
	readonly releaseTag: string;
	readonly sourceCommit: string;
	readonly archiveSha256: string;
	readonly archiveSizeBytes: number;
	readonly indexSha256: string;
	readonly indexSizeBytes: number;
	readonly fingerprint: string;
	readonly documentCount: number;
	readonly assetCount: number;
}

export type EmbeddedDocumentationAssets = EmbeddedDocumentationAssetMetadata &
	(
		| {
				readonly indexPath: string;
		  }
		| {
				readonly indexGzipPath: string;
				readonly indexGzipSha256: string;
				readonly indexGzipSizeBytes: number;
		  }
	);

export interface EmbeddedDocumentationRepositoryOptions {
	readonly cacheRoot?: string;
}

export interface EmbeddedDocumentationRepository extends DocumentationRepository {
	prime(): Promise<void>;
}

type QmdStore = Awaited<ReturnType<typeof createStore>>;

interface MaterializedSnapshot {
	readonly archivePath: string;
	readonly indexPath: string;
}

interface RepositoryState extends MaterializedSnapshot {
	readonly database: Database;
	readonly store: QmdStore;
}

interface DocumentRow {
	readonly source: DocumentationSource;
	readonly stable_path: string;
	readonly title: string;
	readonly original_url: string;
	readonly markdown: string;
}

interface AssetRow {
	readonly source: DocumentationSource;
	readonly stable_path: string;
	readonly filename: string;
	readonly archive_path: string;
	readonly mime_type: VerifiedDocumentationAsset["mimeType"];
	readonly sha256: string;
	readonly size_bytes: number;
}

async function sha256File(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) hash.update(chunk);
	return hash.digest("hex");
}

async function isVerifiedFile(filePath: string, expectedSize: number, expectedSha256: string): Promise<boolean> {
	try {
		return (await stat(filePath)).size === expectedSize && (await sha256File(filePath)) === expectedSha256;
	} catch {
		return false;
	}
}

async function copyEmbeddedFile(
	sourcePath: string,
	destinationPath: string,
	expectedSize: number,
	expectedSha256: string,
): Promise<void> {
	await Bun.write(destinationPath, Bun.file(sourcePath));
	if (!(await isVerifiedFile(destinationPath, expectedSize, expectedSha256))) {
		throw new Error(`embedded documentation asset checksum mismatch: ${path.basename(destinationPath)}`);
	}
}

async function materializeIndex(assets: EmbeddedDocumentationAssets, destinationPath: string): Promise<void> {
	if ("indexPath" in assets) {
		await copyEmbeddedFile(assets.indexPath, destinationPath, assets.indexSizeBytes, assets.indexSha256);
		return;
	}
	const embeddedIndex = Bun.file(assets.indexGzipPath);
	const compressed = await embeddedIndex.bytes();
	if (embeddedIndex.size !== assets.indexGzipSizeBytes || sha256Bytes(compressed) !== assets.indexGzipSha256) {
		throw new Error("embedded compressed documentation index checksum mismatch");
	}
	let bytes: Uint8Array;
	try {
		bytes = gunzipSync(compressed, { maxOutputLength: assets.indexSizeBytes });
	} catch (error) {
		throw new Error("embedded compressed documentation index is invalid", { cause: error });
	}
	await writeVerifiedIndex(destinationPath, bytes, assets);
}

async function writeVerifiedIndex(
	destinationPath: string,
	bytes: Uint8Array,
	assets: EmbeddedDocumentationAssetMetadata,
): Promise<void> {
	if (bytes.byteLength !== assets.indexSizeBytes || sha256Bytes(bytes) !== assets.indexSha256) {
		throw new Error("embedded documentation index checksum mismatch");
	}
	await Bun.write(destinationPath, bytes);
}

function sha256Bytes(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

async function materializeSnapshot(
	assets: EmbeddedDocumentationAssets,
	cacheRoot: string,
): Promise<MaterializedSnapshot> {
	const snapshotDirectory = path.join(cacheRoot, assets.fingerprint);
	const archivePath = path.join(snapshotDirectory, "html-to-markdown-content.tar.gz");
	const indexPath = path.join(snapshotDirectory, "documentation-index.sqlite");
	if (
		(await isVerifiedFile(archivePath, assets.archiveSizeBytes, assets.archiveSha256)) &&
		(await isVerifiedFile(indexPath, assets.indexSizeBytes, assets.indexSha256))
	) {
		return { archivePath, indexPath };
	}

	await mkdir(cacheRoot, { recursive: true });
	const stagingDirectory = `${snapshotDirectory}.tmp-${randomUUID()}`;
	const staleDirectory = `${snapshotDirectory}.stale-${randomUUID()}`;
	try {
		await mkdir(stagingDirectory, { recursive: true });
		await copyEmbeddedFile(
			assets.archivePath,
			path.join(stagingDirectory, "html-to-markdown-content.tar.gz"),
			assets.archiveSizeBytes,
			assets.archiveSha256,
		);
		await materializeIndex(assets, path.join(stagingDirectory, "documentation-index.sqlite"));

		try {
			await rename(stagingDirectory, snapshotDirectory);
		} catch (error) {
			if (
				(await isVerifiedFile(archivePath, assets.archiveSizeBytes, assets.archiveSha256)) &&
				(await isVerifiedFile(indexPath, assets.indexSizeBytes, assets.indexSha256))
			) {
				await rm(stagingDirectory, { recursive: true, force: true });
				return { archivePath, indexPath };
			}
			try {
				await rename(snapshotDirectory, staleDirectory);
			} catch (renameError) {
				if (!(renameError instanceof Error) || !("code" in renameError) || renameError.code !== "ENOENT") {
					throw error;
				}
			}
			await rename(stagingDirectory, snapshotDirectory);
			await rm(staleDirectory, { recursive: true, force: true });
		}
	} catch (error) {
		await rm(stagingDirectory, { recursive: true, force: true });
		throw new Error(
			`Embedded documentation materialization failed: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}

	if (
		!(await isVerifiedFile(archivePath, assets.archiveSizeBytes, assets.archiveSha256)) ||
		!(await isVerifiedFile(indexPath, assets.indexSizeBytes, assets.indexSha256))
	) {
		throw new Error("Embedded documentation cache did not produce the pinned snapshot");
	}
	return { archivePath, indexPath };
}

function verifyDatabase(database: Database, assets: EmbeddedDocumentationAssets): void {
	const integrity = database.query("PRAGMA quick_check").get() as Record<string, string> | null;
	if (!integrity || Object.values(integrity)[0] !== "ok")
		throw new Error("documentation index integrity check failed");
	const provenanceRows = database
		.query("SELECT key, value FROM documentation_provenance ORDER BY key")
		.all() as Array<{
		key: string;
		value: string;
	}>;
	const provenance = Object.fromEntries(provenanceRows.map(row => [row.key, row.value]));
	const expected = {
		archive_sha256: assets.archiveSha256,
		asset_count: String(assets.assetCount),
		document_count: String(assets.documentCount),
		fingerprint: assets.fingerprint,
		release_tag: assets.releaseTag,
		source_commit: assets.sourceCommit,
	};
	if (JSON.stringify(provenance) !== JSON.stringify(expected)) {
		throw new Error("documentation index provenance does not match embedded snapshot");
	}
	const documentCount = database.query("SELECT count(*) AS count FROM documentation_documents").get() as {
		count: number;
	};
	const assetCount = database.query("SELECT count(*) AS count FROM documentation_assets").get() as { count: number };
	if (documentCount.count !== assets.documentCount || assetCount.count !== assets.assetCount) {
		throw new Error("documentation index counts do not match embedded snapshot");
	}
}

function stablePathFromResult(displayPath: string, source: DocumentationSource): string | null {
	const prefix = `${source}/`;
	const suffix = "/index.md";
	if (!displayPath.startsWith(prefix) || !displayPath.endsWith(suffix)) return null;
	const stablePath = displayPath.slice(prefix.length, -suffix.length);
	return stablePath || null;
}

function boundedSnippet(markdown: string, query: string): string {
	const body = markdown
		.replace(/^---\n.*?\n---\n?/s, "")
		.replace(/\s+/g, " ")
		.trim();
	if (body.length <= 600) return body;
	const terms = query
		.toLowerCase()
		.split(/\s+/)
		.filter(term => term.length > 2);
	const lowered = body.toLowerCase();
	const position = terms.map(term => lowered.indexOf(term)).find(index => index >= 0) ?? 0;
	const start = Math.max(0, position - 120);
	const prefix = start > 0 ? "…" : "";
	const suffix = start + 598 < body.length ? "…" : "";
	return `${prefix}${body.slice(start, start + 598 - prefix.length - suffix.length)}${suffix}`;
}

function lexicalDocumentationQuery(query: string): string {
	return query.replace(/^\s*(?:what|who)\s+(?:is|are)\s+/i, "").trim() || query;
}

export function createEmbeddedDocumentationRepository(
	assets: EmbeddedDocumentationAssets,
	options: EmbeddedDocumentationRepositoryOptions = {},
): EmbeddedDocumentationRepository {
	const cacheRoot = options.cacheRoot ?? path.join(os.homedir(), ".xcsh", "cache", "documentation");
	let statePromise: Promise<RepositoryState> | undefined;
	const state = (): Promise<RepositoryState> => {
		if (!statePromise) {
			statePromise = materializeSnapshot(assets, cacheRoot).then(async materialized => {
				const database = new Database(materialized.indexPath, { readonly: true });
				try {
					verifyDatabase(database, assets);
					const store = await createStore({ dbPath: materialized.indexPath, readonly: true });
					return { ...materialized, database, store };
				} catch (error) {
					database.close();
					throw error;
				}
			});
		}
		return statePromise;
	};

	return {
		provenance: {
			releaseTag: assets.releaseTag,
			sourceCommit: assets.sourceCommit,
			archiveSha256: assets.archiveSha256,
			indexSha256: assets.indexSha256,
			fingerprint: assets.fingerprint,
			documentCount: assets.documentCount,
			assetCount: assets.assetCount,
		},
		prime: async () => {
			await state();
		},
		search: async (query, source, limit): Promise<readonly DocumentationSearchResult[]> => {
			const current = await state();
			const results = await current.store.searchLex(lexicalDocumentationQuery(query), { limit, collection: source });
			const rows: DocumentationSearchResult[] = [];
			const lookup = current.database.query(
				"SELECT source, stable_path, title, original_url, markdown FROM documentation_documents WHERE source = ? AND stable_path = ?",
			);
			for (const result of results) {
				const resultSource = result.collectionName as DocumentationSource;
				const stablePath = stablePathFromResult(result.displayPath, resultSource);
				if (!stablePath) continue;
				const row = lookup.get(resultSource, stablePath) as DocumentRow | null;
				if (!row) continue;
				rows.push({
					title: row.title,
					source: row.source,
					originalUrl: row.original_url,
					stablePath: row.stable_path,
					snippet: boundedSnippet(row.markdown, query),
					score: result.score,
				});
			}
			return rows.slice(0, limit);
		},
		readDocument: async (source, stablePath): Promise<DocumentationDocument | null> => {
			const current = await state();
			const row = current.database
				.query(
					"SELECT title, original_url, markdown FROM documentation_documents WHERE source = ? AND stable_path = ?",
				)
				.get(source, stablePath) as Pick<DocumentRow, "title" | "original_url" | "markdown"> | null;
			return row ? { markdown: row.markdown, title: row.title, originalUrl: row.original_url } : null;
		},
		readAsset: async (source, stablePath, filename): Promise<DocumentationAsset | null> => {
			const current = await state();
			const row = current.database
				.query(
					"SELECT source, stable_path, filename, archive_path, mime_type, sha256, size_bytes FROM documentation_assets WHERE source = ? AND stable_path = ? AND filename = ?",
				)
				.get(source, stablePath, filename) as AssetRow | null;
			if (!row) return null;
			const asset: VerifiedDocumentationAsset = {
				source: row.source,
				stablePath: row.stable_path,
				filename: row.filename,
				archivePath: row.archive_path,
				mimeType: row.mime_type,
				sha256: row.sha256,
				sizeBytes: row.size_bytes,
			};
			const extracted = await extractVerifiedDocumentationAsset(
				current.archivePath,
				asset,
				path.join(cacheRoot, assets.fingerprint),
				"assets",
			);
			return { data: (await readFile(extracted)).toString("base64"), mimeType: asset.mimeType };
		},
	};
}
