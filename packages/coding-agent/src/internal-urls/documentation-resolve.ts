import {
	DOCUMENTATION_CONTENT_TYPES,
	DOCUMENTATION_LIFECYCLES,
	DOCUMENTATION_TASK_TYPES,
	type DocumentationContentType,
	type DocumentationLifecycle,
	type DocumentationRelatedDocument,
	type DocumentationTaskType,
} from "./documentation-metadata";
import type { InternalResource, InternalUrl } from "./types";

export const DOCUMENTATION_SOURCES = ["docs-cloud-f5-com", "my-f5-com", "www-f5-com"] as const;
export type DocumentationSource = (typeof DOCUMENTATION_SOURCES)[number];

export interface DocumentationProvenance {
	readonly releaseTag: string;
	readonly sourceCommit: string;
	readonly archiveSha256: string;
	readonly indexSha256: string;
	readonly fingerprint: string;
	readonly documentCount: number;
	readonly assetCount: number;
}

export interface DocumentationSearchResult {
	readonly title: string;
	readonly source: DocumentationSource;
	readonly originalUrl: string;
	readonly stablePath: string;
	readonly snippet: string;
	readonly score: number;
	readonly anchor?: string;
	readonly heading?: string;
	readonly canonicalUrl?: string;
	readonly lastUpdated?: string | null;
	readonly product?: string | null;
	readonly contentType?: DocumentationContentType;
	readonly taskType?: DocumentationTaskType;
	readonly language?: string;
	readonly lifecycle?: DocumentationLifecycle;
	readonly replacementUrl?: string | null;
	readonly aliases?: readonly string[];
	readonly relatedDocuments?: readonly DocumentationRelatedDocument[];
}

export interface DocumentationDocument {
	readonly markdown: string;
	readonly title: string;
	readonly originalUrl: string;
	readonly lifecycle?: DocumentationLifecycle;
	readonly replacementUrl?: string | null;
}

export interface DocumentationSearchFilters {
	readonly product?: string;
	readonly contentType?: DocumentationContentType;
	readonly taskType?: DocumentationTaskType;
	readonly language?: string;
	readonly lifecycle?: DocumentationLifecycle;
}

export interface DocumentationAsset {
	readonly data: string;
	readonly mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
}

export interface DocumentationRepository {
	readonly provenance: DocumentationProvenance;
	search(
		query: string,
		source: DocumentationSource | undefined,
		limit: number,
		filters?: DocumentationSearchFilters,
	): Promise<readonly DocumentationSearchResult[]>;
	readDocument(
		source: DocumentationSource,
		stablePath: string,
		anchor?: string,
	): Promise<DocumentationDocument | null>;
	readAsset(source: DocumentationSource, stablePath: string, filename: string): Promise<DocumentationAsset | null>;
}

export interface DocumentationResolver {
	resolve(url: InternalUrl): Promise<InternalResource>;
}

const SOURCE_SET = new Set<string>(DOCUMENTATION_SOURCES);
const IMAGE_NAME = /^[a-f0-9]{64}\.(?:gif|jpe?g|png|svg|webp)$/;
const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const MAX_QUERY_BYTES = 512;
const MAX_SNIPPET_CHARS = 600;
const PRODUCT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function validateQuery(url: InternalUrl): {
	search?: string;
	source?: DocumentationSource;
	limit: number;
	filters: DocumentationSearchFilters;
} {
	const allowed = new Set([
		"search",
		"source",
		"limit",
		"product",
		"content_type",
		"task_type",
		"language",
		"lifecycle",
	]);
	for (const key of url.searchParams.keys()) {
		if (!allowed.has(key)) throw new Error(`Unknown documentation parameter: ${key}`);
		if (url.searchParams.getAll(key).length !== 1) throw new Error(`Duplicate documentation parameter: ${key}`);
	}
	const search = url.searchParams.get("search")?.trim();
	if (search !== undefined && (!search || Buffer.byteLength(search, "utf8") > MAX_QUERY_BYTES)) {
		throw new Error("Documentation search must contain 1 to 512 UTF-8 bytes");
	}
	const sourceValue = url.searchParams.get("source") ?? undefined;
	if (sourceValue !== undefined && !SOURCE_SET.has(sourceValue)) {
		throw new Error(`Unknown documentation source: ${sourceValue}`);
	}
	const limitValue = url.searchParams.get("limit");
	if (limitValue !== null && !/^(?:[1-9]|10)$/.test(limitValue)) {
		throw new Error("Documentation search limit must be an integer from 1 to 10");
	}
	if (!search && (sourceValue !== undefined || limitValue !== null)) {
		throw new Error("Documentation filters and limit require search");
	}
	const product = url.searchParams.get("product") ?? undefined;
	if (product !== undefined && !PRODUCT.test(product)) throw new Error(`Invalid documentation product: ${product}`);
	const contentType = url.searchParams.get("content_type") ?? undefined;
	if (contentType !== undefined && !DOCUMENTATION_CONTENT_TYPES.includes(contentType as DocumentationContentType))
		throw new Error(`Invalid documentation content type: ${contentType}`);
	const taskType = url.searchParams.get("task_type") ?? undefined;
	if (taskType !== undefined && !DOCUMENTATION_TASK_TYPES.includes(taskType as DocumentationTaskType))
		throw new Error(`Invalid documentation task type: ${taskType}`);
	const language = url.searchParams.get("language") ?? undefined;
	if (language !== undefined && !LANGUAGE.test(language))
		throw new Error(`Invalid documentation language: ${language}`);
	const lifecycle = url.searchParams.get("lifecycle") ?? undefined;
	if (lifecycle !== undefined && !DOCUMENTATION_LIFECYCLES.includes(lifecycle as DocumentationLifecycle))
		throw new Error(`Invalid documentation lifecycle: ${lifecycle}`);
	if (!search && [...url.searchParams.keys()].some(key => key !== "search")) {
		throw new Error("Documentation filters and limit require search");
	}
	return {
		search,
		source: sourceValue as DocumentationSource | undefined,
		limit: limitValue === null ? 5 : Number(limitValue),
		filters: {
			product,
			contentType: contentType as DocumentationContentType | undefined,
			taskType: taskType as DocumentationTaskType | undefined,
			language,
			lifecycle: lifecycle as DocumentationLifecycle | undefined,
		},
	};
}

function parseResourcePath(url: InternalUrl): readonly string[] {
	const raw = url.rawPathname ?? url.pathname;
	if (/%(?:2f|5c|2e)/i.test(raw) || raw.includes("\\")) {
		throw new Error("Encoded separators, traversal, and backslashes are not allowed in documentation paths");
	}
	const segments = raw.split("/").filter(Boolean);
	if (segments.some(segment => segment === "." || segment === ".." || !SAFE_SEGMENT.test(segment))) {
		throw new Error("Invalid documentation path");
	}
	return segments;
}

function textResource(url: InternalUrl, content: string, sourcePath: string): InternalResource {
	return {
		url: url.href,
		content,
		contentType: "text/markdown",
		size: Buffer.byteLength(content, "utf8"),
		sourcePath,
	};
}

function inventory(repository: DocumentationRepository): string {
	const p = repository.provenance;
	return [
		"# Offline F5 documentation",
		"",
		`Snapshot: \`${p.releaseTag}\``,
		`Source commit: \`${p.sourceCommit}\``,
		`Archive SHA-256: \`${p.archiveSha256}\``,
		`Index SHA-256: \`${p.indexSha256}\``,
		`Index fingerprint: \`${p.fingerprint}\``,
		`${p.documentCount} documents; ${p.assetCount} assets.`,
		"",
		"Sources:",
		...DOCUMENTATION_SOURCES.map(source => `- \`${source}\``),
		"",
		"Search with `xcsh://documentation/?search=<query>&source=<optional-source>&product=<slug>&content_type=<type>&task_type=<type>&language=<tag>&lifecycle=<state>&limit=<1-10>`.",
	].join("\n");
}

function renderSearch(
	repository: DocumentationRepository,
	query: string,
	results: readonly DocumentationSearchResult[],
): string {
	const lines = [
		`# Offline documentation search: ${query}`,
		"",
		`Snapshot: \`${repository.provenance.releaseTag}\``,
		"",
	];
	for (const result of results) {
		const snippet = result.snippet.replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET_CHARS);
		const followUp = `xcsh://documentation/${result.source}/${result.stablePath}/index.md${result.anchor ? `#${result.anchor}` : ""}`;
		lines.push(
			`## ${result.title}`,
			`- Source: \`${result.source}\``,
			`- Original: ${result.originalUrl}`,
			`- Canonical: ${result.canonicalUrl ?? result.originalUrl}`,
			`- Last updated: ${result.lastUpdated ?? "unknown"}`,
			`- Product: ${result.product ?? "unclassified"}`,
			`- Content type: ${result.contentType}`,
			`- Task type: ${result.taskType}`,
			`- Section: ${result.heading ?? result.anchor ?? "document"}`,
			`- Language: ${result.language}`,
			`- Lifecycle: ${result.lifecycle}`,
			`- Aliases: ${result.aliases?.join(", ") || "none"}`,
			`- Score: ${result.score}`,
			`- Read: \`${followUp}\``,
			"",
			snippet,
			"",
		);
		if (result.lifecycle && result.lifecycle !== "current") {
			lines.push(
				`> Warning: this document is ${result.lifecycle}.${result.replacementUrl ? ` Replacement: ${result.replacementUrl}` : ""}`,
				"",
			);
		}
		if ((result.relatedDocuments?.length ?? 0) > 0) {
			lines.push(
				"Related documents:",
				...(result.relatedDocuments ?? []).map(
					related =>
						`- ${related.relation}: [${related.title}](xcsh://documentation/${related.source}/${related.stablePath}/index.md)`,
				),
				"",
			);
		}
	}
	if (results.length === 0) lines.push("No matching documents found.", "");
	return lines.join("\n");
}

export function createDocumentationResolver(repository: DocumentationRepository): DocumentationResolver {
	return {
		resolve: async (url: InternalUrl): Promise<InternalResource> => {
			const query = validateQuery(url);
			const segments = parseResourcePath(url);
			if (query.search) {
				if (segments.length !== 0) throw new Error("Documentation search is available only at the root");
				const results = await repository.search(query.search, query.source, query.limit, query.filters);
				return textResource(url, renderSearch(repository, query.search, results), "xcsh://documentation/");
			}
			if (segments.length === 0) {
				return textResource(url, inventory(repository), "xcsh://documentation/");
			}
			const [sourceValue, ...rest] = segments;
			if (!SOURCE_SET.has(sourceValue ?? "")) throw new Error(`Unknown documentation source: ${sourceValue ?? ""}`);
			const source = sourceValue as DocumentationSource;
			if (rest.at(-1) === "index.md") {
				const stablePath = rest.slice(0, -1).join("/");
				if (!stablePath) throw new Error("Documentation path is missing");
				const rawAnchor = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
				if (/%(?:2f|5c|2e)/i.test(rawAnchor)) throw new Error("Invalid documentation anchor");
				const anchor = rawAnchor ? decodeURIComponent(rawAnchor) : undefined;
				if (anchor && (anchor.length > 256 || !/^[\p{L}\p{N}\p{M}_-]+$/u.test(anchor)))
					throw new Error("Invalid documentation anchor");
				const document = await repository.readDocument(source, stablePath, anchor);
				if (!document) throw new Error(`Documentation file not found: ${source}/${stablePath}/index.md`);
				const warning =
					!document.lifecycle || document.lifecycle === "current"
						? ""
						: `> Warning: this document is ${document.lifecycle}.${document.replacementUrl ? ` Replacement: ${document.replacementUrl}` : ""}\n\n`;
				return textResource(
					url,
					`${warning}${document.markdown}`,
					`xcsh://documentation/${source}/${stablePath}/index.md${anchor ? `#${anchor}` : ""}`,
				);
			}
			const assetsIndex = rest.length - 2;
			if (assetsIndex >= 1 && rest[assetsIndex] === "assets" && IMAGE_NAME.test(rest.at(-1) ?? "")) {
				const stablePath = rest.slice(0, assetsIndex).join("/");
				const filename = rest.at(-1)!;
				const asset = await repository.readAsset(source, stablePath, filename);
				if (!asset) throw new Error(`Documentation asset not found: ${source}/${stablePath}/assets/${filename}`);
				return {
					url: url.href,
					content: asset.data,
					contentType: asset.mimeType,
					encoding: "base64",
					size: Buffer.from(asset.data, "base64").byteLength,
					sourcePath: `xcsh://documentation/${source}/${stablePath}/assets/${filename}`,
				};
			}
			throw new Error("Unknown documentation path or non-manifest file");
		},
	};
}
