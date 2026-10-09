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
	DocumentationSearchFilters,
	DocumentationSearchResult,
	DocumentationSource,
} from "./documentation-resolve";
import { DOCUMENTATION_SOURCES } from "./documentation-resolve";
import { extractVerifiedDocumentationAsset, type VerifiedDocumentationAsset } from "./documentation-snapshot";

interface EmbeddedDocumentationAssetMetadata {
	readonly archivePath?: string;
	readonly releaseTag: string;
	readonly sourceCommit: string;
	readonly archiveSha256: string;
	readonly archiveSizeBytes: number;
	readonly indexSha256: string;
	readonly indexSizeBytes: number;
	readonly fingerprint: string;
	readonly documentCount: number;
	readonly assetCount: number;
	readonly textManifestSha256?: string | null;
	readonly bundledAssetCount?: number;
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
	readonly archivePath?: string;
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
	readonly canonical_url: string;
	readonly last_updated: string | null;
	readonly product: string | null;
	readonly content_type: DocumentationSearchResult["contentType"];
	readonly task_type: DocumentationSearchResult["taskType"];
	readonly language: string;
	readonly lifecycle: DocumentationSearchResult["lifecycle"];
	readonly replacement_url: string | null;
	readonly aliases_json: string;
	readonly related_documents_json: string;
}

interface PassageRow extends DocumentRow {
	readonly anchor: string;
	readonly heading: string;
	readonly passage_markdown: string;
	readonly ordinal: number;
	readonly score: number;
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
		(!assets.archivePath || (await isVerifiedFile(archivePath, assets.archiveSizeBytes, assets.archiveSha256))) &&
		(await isVerifiedFile(indexPath, assets.indexSizeBytes, assets.indexSha256))
	) {
		return { archivePath, indexPath };
	}

	await mkdir(cacheRoot, { recursive: true });
	const stagingDirectory = `${snapshotDirectory}.tmp-${randomUUID()}`;
	const staleDirectory = `${snapshotDirectory}.stale-${randomUUID()}`;
	try {
		await mkdir(stagingDirectory, { recursive: true });
		if (assets.archivePath) {
			await copyEmbeddedFile(
				assets.archivePath,
				path.join(stagingDirectory, "html-to-markdown-content.tar.gz"),
				assets.archiveSizeBytes,
				assets.archiveSha256,
			);
		}
		await materializeIndex(assets, path.join(stagingDirectory, "documentation-index.sqlite"));

		try {
			await rename(stagingDirectory, snapshotDirectory);
		} catch (error) {
			if (
				(!assets.archivePath ||
					(await isVerifiedFile(archivePath, assets.archiveSizeBytes, assets.archiveSha256))) &&
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
		(assets.archivePath && !(await isVerifiedFile(archivePath, assets.archiveSizeBytes, assets.archiveSha256))) ||
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
		index_schema: "4",
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

function ftsPhrase(value: string): string {
	return value
		.normalize("NFKC")
		.replace(/[^\p{L}\p{N}_-]+/gu, " ")
		.replace(/-/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function aliasGroups(database: Database): readonly (readonly string[])[] {
	const rows = database
		.query("SELECT product, alias FROM documentation_aliases ORDER BY product, alias")
		.all() as Array<{
		product: string;
		alias: string;
	}>;
	const groups = new Map<string, string[]>();
	for (const row of rows) groups.set(row.product, [...(groups.get(row.product) ?? []), row.alias]);
	return [...groups.values()].sort(
		(left, right) => Math.max(...right.map(value => value.length)) - Math.max(...left.map(value => value.length)),
	);
}

function escapedFtsQuery(database: Database, query: string): string {
	let remaining = lexicalDocumentationQuery(query);
	const expansions: string[] = [];
	for (const aliases of aliasGroups(database)) {
		const matched = [...aliases]
			.sort((left, right) => right.length - left.length)
			.find(alias =>
				new RegExp(
					`(^|[^\\p{L}\\p{N}])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`,
					"iu",
				).test(remaining),
			);
		if (!matched) continue;
		remaining = remaining.replace(new RegExp(matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"), " ");
		expansions.push(`(${aliases.map(alias => `"${ftsPhrase(alias)}"`).join(" OR ")})`);
	}
	const terms =
		remaining
			.match(/[\p{L}\p{N}_-]+/gu)
			?.map(term => ftsPhrase(term))
			.filter(Boolean) ?? [];
	return [...expansions, ...terms.map(term => `"${term}"*`)].join(" AND ");
}

function searchRows(
	database: Database,
	query: string,
	source: DocumentationSource | undefined,
	filters: DocumentationSearchFilters,
): PassageRow[] {
	const clauses = ["documents_fts MATCH ?", "d.active = 1"];
	const parameters: Array<string | null> = [escapedFtsQuery(database, query)];
	const add = (column: string, value: string | undefined): void => {
		if (value === undefined) return;
		clauses.push(`${column} = ?`);
		parameters.push(value);
	};
	add("dd.source", source);
	add("dd.product", filters.product);
	add("dd.content_type", filters.contentType);
	add("dd.task_type", filters.taskType);
	add("dd.language", filters.language);
	add("dd.lifecycle", filters.lifecycle);
	if (!parameters[0]) return [];
	return database
		.query(`WITH scored AS (
			SELECT dd.*, p.anchor, p.heading, p.markdown AS passage_markdown, p.ordinal,
				ROUND(ABS(bm25(documents_fts, 1.5, 4.0, 1.0)) /
				(1.0 + ABS(bm25(documents_fts, 1.5, 4.0, 1.0))) *
				CASE dd.lifecycle WHEN 'deprecated' THEN 0.85 WHEN 'superseded' THEN 0.65 ELSE 1.0 END, 12) AS score
			FROM documents_fts
			JOIN documents d ON d.id = documents_fts.rowid
			JOIN documentation_passages p ON p.source = d.collection AND p.qmd_path = d.path
			JOIN documentation_documents dd ON dd.source = p.source AND dd.stable_path = p.stable_path
			WHERE ${clauses.join(" AND ")}
		), ranked AS (
			SELECT *, ROW_NUMBER() OVER (
				PARTITION BY source, stable_path ORDER BY score DESC, ordinal ASC
			) AS page_rank FROM scored
		)
		SELECT * FROM ranked WHERE page_rank = 1`)
		.all(...parameters) as PassageRow[];
}

function diversifySources(
	results: readonly PassageRow[],
	preferredSource: DocumentationSource | undefined,
	limit: number,
): PassageRow[] {
	const selected: PassageRow[] = [];
	const seen = new Set<string>();
	const sourceOrder = preferredSource
		? [preferredSource, ...DOCUMENTATION_SOURCES.filter(source => source !== preferredSource)]
		: [...DOCUMENTATION_SOURCES].sort((left, right) => {
				const leftScore = results.find(result => result.source === left)?.score ?? -1;
				const rightScore = results.find(result => result.source === right)?.score ?? -1;
				return rightScore - leftScore || left.localeCompare(right);
			});
	for (const source of sourceOrder) {
		const result = results.find(candidate => candidate.source === source);
		if (!result) continue;
		selected.push(result);
		seen.add(`${result.source}\0${result.stable_path}`);
	}
	for (const result of results) {
		const key = `${result.source}\0${result.stable_path}`;
		if (seen.has(key)) continue;
		selected.push(result);
		seen.add(key);
	}
	return selected.slice(0, limit);
}

const SUPPORT_QUERY = /\b(?:troubleshoot|support|knowledge[- ]base|error|failure|issue|K[0-9]{6,})\b/i;
const COMMUNITY_QUERY = /\b(?:example|walkthrough|tutorial|community|forum|discussion|troubleshoot|troubleshooting)\b/i;
const CONFIGURATION_QUERY = /\b(?:configure|configuration|set\s*up|procedure|instructions?|how\s+(?:do|can|to))\b/i;
const CONCEPTUAL_QUERY = /\b(?:what\s+(?:is|are)|overview|product|solution|capabilities|benefits)\b/i;
const MARKETING_TOPIC =
	/\b(?:client[- ]side defense|distributed cloud|web (?:app|application) and api protection|multi[- ]cloud networking|dns load balancer|bot defense|api security|app connect|appstack|content delivery network|cdn|mobile app shield|synthetic monitoring|web app scanning)\b/i;

function preferredDocumentationSource(query: string): DocumentationSource | undefined {
	if (COMMUNITY_QUERY.test(query)) return "community-f5-com";
	if (SUPPORT_QUERY.test(query)) return "my-f5-com";
	if (CONFIGURATION_QUERY.test(query)) return "docs-cloud-f5-com";
	if (CONCEPTUAL_QUERY.test(query) || MARKETING_TOPIC.test(query)) return "www-f5-com";
	return undefined;
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
			bundledAssetCount: assets.bundledAssetCount ?? assets.assetCount,
		},
		prime: async () => {
			await state();
		},
		search: async (query, source, limit, filters = {}): Promise<readonly DocumentationSearchResult[]> => {
			const current = await state();
			const preferredSource = source ? undefined : preferredDocumentationSource(query);
			const results = searchRows(current.database, query, source, filters);
			results.sort((left, right) => {
				const sourceOrder = Number(right.source === preferredSource) - Number(left.source === preferredSource);
				return (
					sourceOrder ||
					right.score - left.score ||
					left.source.localeCompare(right.source) ||
					left.stable_path.localeCompare(right.stable_path)
				);
			});
			const selected = source ? results.slice(0, limit) : diversifySources(results, preferredSource, limit);
			return selected.map(row => ({
				title: row.title,
				source: row.source,
				originalUrl: row.original_url,
				stablePath: row.stable_path,
				snippet: boundedSnippet(row.passage_markdown, query),
				score: Number(row.score.toFixed(12)),
				anchor: row.anchor,
				heading: row.heading,
				canonicalUrl: row.canonical_url,
				lastUpdated: row.last_updated,
				product: row.product,
				contentType: row.content_type,
				taskType: row.task_type,
				language: row.language,
				lifecycle: row.lifecycle,
				replacementUrl: row.replacement_url,
				aliases: JSON.parse(row.aliases_json),
				relatedDocuments: JSON.parse(row.related_documents_json),
			}));
		},
		readDocument: async (source, stablePath, anchor): Promise<DocumentationDocument | null> => {
			const current = await state();
			const route = current.database
				.query(
					"SELECT target_source, target_stable_path FROM documentation_routes WHERE source = ? AND stable_path = ?",
				)
				.get(source, stablePath) as { target_source: DocumentationSource; target_stable_path: string } | null;
			if (route) {
				source = route.target_source;
				stablePath = route.target_stable_path;
			}

			const row = current.database
				.query(
					"SELECT title, original_url, markdown, lifecycle, replacement_url FROM documentation_documents WHERE source = ? AND stable_path = ?",
				)
				.get(source, stablePath) as Pick<
				DocumentRow,
				"title" | "original_url" | "markdown" | "lifecycle" | "replacement_url"
			> | null;
			if (!row) return null;
			let markdown = row.markdown;
			if (anchor) {
				const passage = current.database
					.query("SELECT markdown FROM documentation_passages WHERE source = ? AND stable_path = ? AND anchor = ?")
					.get(source, stablePath, anchor) as { markdown: string } | null;
				if (!passage) return null;
				markdown = passage.markdown;
			}
			return {
				markdown: markdown.replace(
					/!\[([^\]]*)\]\(assets\/[a-f0-9]{64}\.(?:gif|jpe?g|png|svg|webp)\)/g,
					(_match, alt: string) => `[${alt || "Image"} on source page](${row.original_url})`,
				),
				title: row.title,
				originalUrl: row.original_url,
				lifecycle: row.lifecycle,
				replacementUrl: row.replacement_url,
			};
		},
		readAsset: async (source, stablePath, filename): Promise<DocumentationAsset | null> => {
			const current = await state();
			const route = current.database
				.query(
					"SELECT target_source, target_stable_path FROM documentation_routes WHERE source = ? AND stable_path = ?",
				)
				.get(source, stablePath) as { target_source: DocumentationSource; target_stable_path: string } | null;
			if (route) {
				source = route.target_source;
				stablePath = route.target_stable_path;
			}

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
			if (!current.archivePath || !assets.archivePath) {
				const document = current.database
					.query("SELECT original_url FROM documentation_documents WHERE source = ? AND stable_path = ?")
					.get(source, stablePath) as { original_url: string } | null;
				if (!document) throw new Error("documentation media has no verified source page");
				return { publicUrl: document.original_url, mimeType: asset.mimeType };
			}
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
