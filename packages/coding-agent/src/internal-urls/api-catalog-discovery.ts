import { createHash } from "node:crypto";
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
