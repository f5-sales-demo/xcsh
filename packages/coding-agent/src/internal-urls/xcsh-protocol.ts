/**
 * Protocol handler for xcsh:// URLs.
 *
 * Serves statically embedded documentation files bundled at build time,
 * plus the runtime-resolved `about` identity doc.
 *
 * URL forms:
 * - xcsh:// - Lists all available documentation files
 * - xcsh://<file>.md - Reads a specific documentation file
 * - xcsh://about - Identity fingerprint (version, commit, branch, repo)
 * - xcsh://api-spec/ - API specification index
 * - xcsh://api-spec/{domain} - Domain detail
 * - xcsh://api-spec/{domain}?resource={name} - Resource spec
 * - xcsh://api-spec/workflows/ - Guided API workflows
 * - xcsh://api-spec/errors/ - Error resolution
 * - xcsh://api-spec/glossary/ - Acronym glossary
 * - xcsh://api-catalog/ - API operation catalog
 * - xcsh://api-catalog/{category} - Category operations with curl templates
 */
import * as path from "node:path";
import { logger } from "@f5xc-salesdemos/pi-utils";
import type { ContextStatus } from "../services/f5xc-context";
import { type ApiCatalogResolver, createApiCatalogResolver } from "./api-catalog-resolve";
import type { ApiCatalogCategory, ApiCatalogCategorySummary, ApiCatalogIndex } from "./api-catalog-types";
import { type ApiSpecResolver, createApiSpecResolver } from "./api-spec-resolve";
import type { ApiSpecIndex, OpenAPISpec } from "./api-spec-types";
import { getRuntimeBuildInfo, type RuntimeBuildInfo, renderAboutDoc } from "./build-info-runtime";
import { EMBEDDED_DOC_FILENAMES, EMBEDDED_DOCS } from "./docs-index.generated";
import type { InternalResource, InternalUrl, ProtocolHandler } from "./types";

const SCHEME_PREFIX = "xcsh://";
const ABOUT_ROUTE = "about";
const API_SPEC_HOST = "api-spec";
const API_CATALOG_HOST = "api-catalog";

const EMPTY_INDEX: ApiSpecIndex = { version: "unavailable", timestamp: "", domains: [] };
const EMPTY_CATALOG_INDEX: ApiCatalogIndex = {
	version: "unavailable",
	displayName: "F5 Distributed Cloud",
	service: "f5xc",
	categoryCount: 0,
	auth: { type: "", headerName: "", headerTemplate: "", tokenSource: "", baseUrlSource: "" },
	defaults: {},
};

let _apiSpecCache: { index: ApiSpecIndex; data: Readonly<Record<string, OpenAPISpec>>; version: string } | null = null;

function loadApiSpecs(): { index: ApiSpecIndex; data: Readonly<Record<string, OpenAPISpec>>; version: string } {
	if (_apiSpecCache) return _apiSpecCache;
	try {
		const mod = require("./api-spec-index.generated") as {
			API_SPEC_INDEX?: ApiSpecIndex;
			API_SPEC_DATA?: Readonly<Record<string, unknown>>;
			API_SPEC_VERSION?: string;
		};
		const index = mod.API_SPEC_INDEX ?? EMPTY_INDEX;
		const version = mod.API_SPEC_VERSION ?? "unknown";
		if (index.domains.length === 0) {
			logger.warn("api-spec index loaded but contains 0 domains");
		}
		_apiSpecCache = {
			index,
			data: (mod.API_SPEC_DATA ?? {}) as Readonly<Record<string, OpenAPISpec>>,
			version,
		};
	} catch (err) {
		logger.warn("api-spec index unavailable, embedded specs disabled", {
			error: err instanceof Error ? err.message : String(err),
		});
		_apiSpecCache = { index: EMPTY_INDEX, data: {}, version: "unavailable" };
	}
	return _apiSpecCache;
}

let _apiCatalogCache: {
	index: ApiCatalogIndex;
	summaries: readonly ApiCatalogCategorySummary[];
	data: Readonly<Record<string, ApiCatalogCategory>>;
} | null = null;

function loadApiCatalog(): {
	index: ApiCatalogIndex;
	summaries: readonly ApiCatalogCategorySummary[];
	data: Readonly<Record<string, ApiCatalogCategory>>;
} {
	if (_apiCatalogCache) return _apiCatalogCache;
	try {
		const mod = require("./api-catalog-index.generated") as {
			API_CATALOG_INDEX?: ApiCatalogIndex;
			API_CATALOG_CATEGORY_SUMMARIES?: readonly ApiCatalogCategorySummary[];
			API_CATALOG_DATA?: Readonly<Record<string, ApiCatalogCategory>>;
		};
		const index = mod.API_CATALOG_INDEX ?? EMPTY_CATALOG_INDEX;
		const summaries = mod.API_CATALOG_CATEGORY_SUMMARIES ?? [];
		if (summaries.length === 0) {
			logger.warn("api-catalog index loaded but contains 0 categories");
		}
		_apiCatalogCache = {
			index,
			summaries,
			data: mod.API_CATALOG_DATA ?? {},
		};
	} catch (err) {
		logger.warn("api-catalog index unavailable, catalog disabled", {
			error: err instanceof Error ? err.message : String(err),
		});
		_apiCatalogCache = { index: EMPTY_CATALOG_INDEX, summaries: [], data: {} };
	}
	return _apiCatalogCache;
}

export interface InternalDocsProtocolOptions {
	readonly resolveBuildInfo?: () => Promise<RuntimeBuildInfo>;
	readonly getContextStatus?: () => ContextStatus | null;
	readonly apiSpecResolver?: ApiSpecResolver;
	readonly apiCatalogResolver?: ApiCatalogResolver;
}

export class InternalDocsProtocolHandler implements ProtocolHandler {
	readonly scheme = "xcsh";
	readonly #resolveBuildInfo: () => Promise<RuntimeBuildInfo>;
	readonly #getContextStatus: (() => ContextStatus | null) | undefined;
	#apiSpecResolver: ApiSpecResolver | null;
	#apiCatalogResolver: ApiCatalogResolver | null;

	constructor(options: InternalDocsProtocolOptions = {}) {
		this.#resolveBuildInfo = options.resolveBuildInfo ?? getRuntimeBuildInfo;
		this.#getContextStatus = options.getContextStatus;
		this.#apiSpecResolver = options.apiSpecResolver ?? null;
		this.#apiCatalogResolver = options.apiCatalogResolver ?? null;
	}

	#getApiSpecResolver(): ApiSpecResolver {
		if (!this.#apiSpecResolver) {
			const specs = loadApiSpecs();
			this.#apiSpecResolver = createApiSpecResolver(specs.index, specs.data);
		}
		return this.#apiSpecResolver;
	}

	#getApiCatalogResolver(): ApiCatalogResolver {
		if (!this.#apiCatalogResolver) {
			const catalog = loadApiCatalog();
			const specs = loadApiSpecs();
			this.#apiCatalogResolver = createApiCatalogResolver(
				catalog.index,
				catalog.summaries,
				catalog.data,
				specs.index,
			);
		}
		return this.#apiCatalogResolver;
	}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const host = url.rawHost || url.hostname;

		if (host === API_SPEC_HOST) {
			return this.#getApiSpecResolver().resolve(url);
		}

		if (host === API_CATALOG_HOST) {
			return this.#getApiCatalogResolver().resolve(url);
		}

		const pathname = url.rawPathname ?? url.pathname;
		const filename = host ? (pathname && pathname !== "/" ? host + pathname : host) : "";

		if (!filename) {
			return this.#listDocs(url);
		}

		return this.#readDoc(filename, url);
	}

	async #listDocs(url: InternalUrl): Promise<InternalResource> {
		if (EMBEDDED_DOC_FILENAMES.length === 0) {
			throw new Error("No documentation files found");
		}

		const specs = loadApiSpecs();
		const catalog = loadApiCatalog();
		const syntheticEntry = `- [${ABOUT_ROUTE}](${SCHEME_PREFIX}${ABOUT_ROUTE}) — identity and build fingerprint`;
		const apiSpecEntry = `- [${API_SPEC_HOST}/](${SCHEME_PREFIX}${API_SPEC_HOST}/) — F5 XC API specifications (${specs.index.domains.length} domains, v${specs.version})`;
		const apiCatalogEntry = `- [${API_CATALOG_HOST}/](${SCHEME_PREFIX}${API_CATALOG_HOST}/) — F5 XC API operation catalog (${catalog.summaries.length} categories, v${catalog.index.version})`;
		const listing = [
			syntheticEntry,
			apiSpecEntry,
			apiCatalogEntry,
			...EMBEDDED_DOC_FILENAMES.map(f => `- [${f}](${SCHEME_PREFIX}${f})`),
		].join("\n");
		const totalCount = EMBEDDED_DOC_FILENAMES.length + 3;
		const content = `# Documentation\n\n${totalCount} files available:\n\n${listing}\n`;

		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: SCHEME_PREFIX,
		};
	}

	async #readDoc(filename: string, url: InternalUrl): Promise<InternalResource> {
		if (path.isAbsolute(filename)) {
			throw new Error(`Absolute paths are not allowed in ${SCHEME_PREFIX} URLs`);
		}

		const normalized = path.posix.normalize(filename.replaceAll("\\", "/"));
		if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
			throw new Error(`Path traversal (..) is not allowed in ${SCHEME_PREFIX} URLs`);
		}

		if (normalized === ABOUT_ROUTE || normalized === `${ABOUT_ROUTE}.md`) {
			const info = await this.#resolveBuildInfo();
			const context = this.#getContextStatus?.() ?? null;
			const content = renderAboutDoc(info, context);
			return {
				url: url.href,
				content,
				contentType: "text/markdown",
				size: Buffer.byteLength(content, "utf-8"),
				sourcePath: `${SCHEME_PREFIX}${ABOUT_ROUTE}`,
			};
		}

		const content = EMBEDDED_DOCS[normalized];
		if (content === undefined) {
			const lookup = normalized.replace(/\.md$/, "");
			const suggestions = EMBEDDED_DOC_FILENAMES.filter(
				f => f.includes(lookup) || lookup.includes(f.replace(/\.md$/, "")),
			).slice(0, 5);
			const suffix =
				suggestions.length > 0
					? `\nDid you mean: ${suggestions.join(", ")}`
					: `\nUse ${SCHEME_PREFIX} to list available files.`;
			throw new Error(`Documentation file not found: ${filename}${suffix}`);
		}

		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: `${SCHEME_PREFIX}${normalized}`,
		};
	}
}
