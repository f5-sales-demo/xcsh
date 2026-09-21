import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createStore } from "@tobilu/qmd";
import type { ApiCatalogCategory, ApiCatalogIndex } from "./api-catalog-types";

export interface ApiCatalogDiscoveryDocument {
	readonly id: string;
	readonly categoryName: string;
	readonly markdown: string;
}

export interface ApiCatalogDiscoveryCorpus {
	readonly catalogVersion: string;
	readonly documents: readonly ApiCatalogDiscoveryDocument[];
}

export interface ApiCatalogDiscoveryCandidate {
	readonly categoryName: string;
	readonly destination: string;
}

export interface QmdBm25PrebuiltIndex {
	readonly fingerprint: string;
	readonly sqliteSha256: string;
	readonly gzipBase64: string;
}

export interface QmdBm25CatalogDiscoveryOptions {
	readonly cacheRoot: string;
	readonly prebuiltIndex: QmdBm25PrebuiltIndex;
	readonly limit?: number;
}

type QmdStore = Awaited<ReturnType<typeof createStore>>;

const qmdStores = new Map<string, Promise<QmdStore>>();
const verifiedIndexPaths = new Map<string, string>();
const indexExtractions = new Map<string, Promise<string>>();

function indexCacheKey(options: QmdBm25CatalogDiscoveryOptions): string {
	return `${options.cacheRoot}\u0000${options.prebuiltIndex.fingerprint}\u0000${options.prebuiltIndex.sqliteSha256}`;
}

async function getQmdStore(databasePath: string): Promise<QmdStore> {
	let store = qmdStores.get(databasePath);
	if (!store) {
		store = createStore({ dbPath: databasePath });
		qmdStores.set(databasePath, store);
	}
	try {
		return await store;
	} catch (error) {
		qmdStores.delete(databasePath);
		throw error;
	}
}

export function normalizeApiCatalogDiscoveryTerm(value: string): string {
	return value.toLowerCase().replace(/[_\s]+/g, "-");
}

/** The legacy text predicate extracted without changing its semantics. */
export function matchesBaselineCatalogDiscoveryTerm(term: string, values: readonly string[]): boolean {
	const normalized = normalizeApiCatalogDiscoveryTerm(term);
	return values.some(value => normalizeApiCatalogDiscoveryTerm(value).includes(normalized));
}

function categoryDocument(category: ApiCatalogCategory): ApiCatalogDiscoveryDocument {
	const destination = `xcsh://api-catalog/${category.name}`;
	const operations = category.operations.flatMap(operation => [
		`- Operation: ${operation.name}`,
		`  - Alias: ${(operation.operationAliases ?? []).join(", ")}`,
		`  - Description: ${operation.description}`,
		`  - Method: ${operation.method.toUpperCase()}`,
		`  - Path: ${operation.path}`,
		`  - Operation ID: ${operation.operationId}`,
	]);

	return {
		id: `category:${category.name}`,
		categoryName: category.name,
		markdown: [
			`# ${category.displayName}`,
			"",
			`- Category: ${category.name}`,
			`- Destination: ${destination}`,
			"",
			"## Operations",
			...(operations.length > 0 ? operations : ["- None"]),
			"",
		].join("\n"),
	};
}

/**
 * Produces a stable, authoritative-only corpus. It intentionally contains no
 * tenant data, credentials, generated examples, or speculative API fields.
 */
export function buildApiCatalogDiscoveryCorpus(
	index: ApiCatalogIndex,
	data: Readonly<Record<string, ApiCatalogCategory>>,
): ApiCatalogDiscoveryCorpus {
	return {
		catalogVersion: index.version,
		documents: Object.values(data)
			.slice()
			.sort((left, right) => left.name.localeCompare(right.name))
			.map(categoryDocument),
	};
}

export function fingerprintApiCatalogDiscoveryCorpus(
	corpus: ApiCatalogDiscoveryCorpus,
	sourceSha: string,
	engineVersion: string,
): string {
	const bytes = JSON.stringify({
		sourceSha,
		catalogVersion: corpus.catalogVersion,
		engineVersion,
		documents: corpus.documents,
	});
	return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Byte-equivalent baseline candidate selection for the existing renderer.
 * Ranking is intentionally unchanged: canonical CRUD promotion stays in the
 * renderer where it has access to API-spec evidence.
 */
export function rankBaselineCatalogDiscovery(
	term: string,
	corpus: ApiCatalogDiscoveryCorpus,
): readonly ApiCatalogDiscoveryCandidate[] {
	return corpus.documents
		.filter(document => matchesBaselineCatalogDiscoveryTerm(term, [document.markdown]))
		.map(document => ({
			categoryName: document.categoryName,
			destination: `xcsh://api-catalog/${document.categoryName}`,
		}));
}

function categoryNameFromQmdBody(body: string): string | null {
	const destination = /^- Destination: xcsh:\/\/api-catalog\/([^\s]+)$/m.exec(body)?.[1];
	return destination && /^[a-z0-9-]+$/.test(destination) ? destination : null;
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

async function verifiedPrebuiltIndexPath(options: QmdBm25CatalogDiscoveryOptions): Promise<string | null> {
	const indexDirectory = path.join(options.cacheRoot, options.prebuiltIndex.fingerprint);
	const databasePath = path.join(indexDirectory, "index.sqlite");
	try {
		const bytes = await Bun.file(databasePath).bytes();
		if (sha256(bytes) === options.prebuiltIndex.sqliteSha256) return databasePath;
	} catch {
		// A missing or corrupt cache is repaired only from the embedded immutable asset.
	}
	return null;
}

/** Materializes the build-produced immutable asset without runtime indexing or downloads. */
async function extractPrebuiltQmdBm25IndexUncached(options: QmdBm25CatalogDiscoveryOptions): Promise<string> {
	const cacheKey = indexCacheKey(options);
	const cached = verifiedIndexPaths.get(cacheKey);
	if (cached) return cached;

	const present = await verifiedPrebuiltIndexPath(options);
	if (present) {
		verifiedIndexPaths.set(cacheKey, present);
		return present;
	}

	const indexDirectory = path.join(options.cacheRoot, options.prebuiltIndex.fingerprint);
	const stagingDirectory = `${indexDirectory}.tmp-${randomUUID()}`;
	await mkdir(options.cacheRoot, { recursive: true });
	try {
		const sqlite = gunzipSync(Buffer.from(options.prebuiltIndex.gzipBase64, "base64"));
		if (sha256(sqlite) !== options.prebuiltIndex.sqliteSha256)
			throw new Error("embedded QMD BM25 SQLite checksum mismatch");
		await mkdir(stagingDirectory, { recursive: true });
		await writeFile(path.join(stagingDirectory, "index.sqlite"), sqlite, { mode: 0o600 });
		try {
			await rename(stagingDirectory, indexDirectory);
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				(error.code !== "EEXIST" && error.code !== "ENOTEMPTY")
			) {
				throw error;
			}
			const winner = await verifiedPrebuiltIndexPath(options);
			if (winner) {
				await rm(stagingDirectory, { recursive: true, force: true });
				verifiedIndexPaths.set(cacheKey, winner);
				return winner;
			}
			// The destination is stale or corrupt. Remove only that unverified
			// directory, then promote the complete checksum-verified staging tree.
			await rm(indexDirectory, { recursive: true, force: true });
			await rename(stagingDirectory, indexDirectory);
		}
		const extracted = await verifiedPrebuiltIndexPath(options);
		if (!extracted) throw new Error("atomic QMD BM25 index extraction did not produce a verified database");
		verifiedIndexPaths.set(cacheKey, extracted);
		return extracted;
	} catch (error) {
		await rm(stagingDirectory, { recursive: true, force: true });
		throw new Error(`QMD BM25 index extraction failed: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
}

/** Shares concurrent checksum-verified extraction; callers never observe a partial index. */
export function extractPrebuiltQmdBm25Index(options: QmdBm25CatalogDiscoveryOptions): Promise<string> {
	const cacheKey = indexCacheKey(options);
	const cached = verifiedIndexPaths.get(cacheKey);
	if (cached) return Promise.resolve(cached);
	const running = indexExtractions.get(cacheKey);
	if (running) return running;
	const extraction = extractPrebuiltQmdBm25IndexUncached(options);
	indexExtractions.set(cacheKey, extraction);
	void extraction
		.finally(() => {
			indexExtractions.delete(cacheKey);
		})
		.catch(() => undefined);
	return extraction;
}

/** Starts the verified model-free store before the first read-tool turn. */
export async function primeQmdBm25CatalogDiscovery(options: QmdBm25CatalogDiscoveryOptions): Promise<void> {
	await getQmdStore(await extractPrebuiltQmdBm25Index(options));
}

/** Model-free in-process QMD BM25 ranking with no CLI, MCP, model, or fallback path. */
export async function rankQmdBm25CatalogDiscovery(
	term: string,
	options: QmdBm25CatalogDiscoveryOptions,
): Promise<readonly ApiCatalogDiscoveryCandidate[]> {
	const store = await getQmdStore(await extractPrebuiltQmdBm25Index(options));
	try {
		const results = await store.searchLex(term, { limit: options.limit ?? 5 });
		return results.flatMap(result => {
			const categoryName = categoryNameFromQmdBody(result.body ?? "");
			return categoryName ? [{ categoryName, destination: `xcsh://api-catalog/${categoryName}` }] : [];
		});
	} catch (error) {
		throw new Error(`QMD BM25 lookup failed: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
}
