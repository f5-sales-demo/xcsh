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
 */
import * as path from "node:path";
import type { ContextStatus } from "../services/f5xc-context";
import { type ApiSpecResolver, createApiSpecResolver } from "./api-spec-resolve";
import type { ApiSpecIndex } from "./api-spec-types";
import { getRuntimeBuildInfo, type RuntimeBuildInfo, renderAboutDoc } from "./build-info-runtime";
import { EMBEDDED_DOC_FILENAMES, EMBEDDED_DOCS } from "./docs-index.generated";
import type { InternalResource, InternalUrl, ProtocolHandler } from "./types";

const SCHEME_PREFIX = "xcsh://";
const ABOUT_ROUTE = "about";
const API_SPEC_HOST = "api-spec";

const EMPTY_INDEX: ApiSpecIndex = { version: "unknown", timestamp: "", domains: [] };

let _apiSpecCache: { index: ApiSpecIndex; blobs: Record<string, string>; version: string } | null = null;

/**
 * Lazily loads the generated API spec index. Uses require() instead of
 * top-level import because the generated file may not exist in all
 * contexts (tarball install, type-check without build). The try-catch
 * falls back to an empty index so the handler degrades gracefully.
 */
function loadApiSpecs(): { index: ApiSpecIndex; blobs: Record<string, string>; version: string } {
	if (_apiSpecCache) return _apiSpecCache;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require("./api-spec-index.generated");
		_apiSpecCache = {
			index: mod.API_SPEC_INDEX ?? EMPTY_INDEX,
			blobs: mod.API_SPEC_BLOBS ?? {},
			version: mod.API_SPEC_VERSION ?? "unknown",
		};
	} catch {
		_apiSpecCache = { index: EMPTY_INDEX, blobs: {}, version: "unknown" };
	}
	return _apiSpecCache;
}

export interface InternalDocsProtocolOptions {
	/** Override runtime build-info resolution. Primarily for tests. */
	readonly resolveBuildInfo?: () => Promise<RuntimeBuildInfo>;
	/** Sync getter returning the current context status (or null if unconfigured / unavailable). */
	readonly getContextStatus?: () => ContextStatus | null;
	/** Override the API spec resolver. Primarily for tests. */
	readonly apiSpecResolver?: ApiSpecResolver;
}

/**
 * Handler for the xcsh:// internal documentation protocol.
 *
 * Resolves documentation file names to their content, lists available docs,
 * and serves the runtime identity doc at xcsh://about.
 */
export class InternalDocsProtocolHandler implements ProtocolHandler {
	readonly scheme = "xcsh";
	readonly #resolveBuildInfo: () => Promise<RuntimeBuildInfo>;
	readonly #getContextStatus: (() => ContextStatus | null) | undefined;
	#apiSpecResolver: ApiSpecResolver | null;

	constructor(options: InternalDocsProtocolOptions = {}) {
		this.#resolveBuildInfo = options.resolveBuildInfo ?? getRuntimeBuildInfo;
		this.#getContextStatus = options.getContextStatus;
		this.#apiSpecResolver = options.apiSpecResolver ?? null;
	}

	#getApiSpecResolver(): ApiSpecResolver {
		if (!this.#apiSpecResolver) {
			const specs = loadApiSpecs();
			this.#apiSpecResolver = createApiSpecResolver(specs.index, specs.blobs);
		}
		return this.#apiSpecResolver;
	}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const host = url.rawHost || url.hostname;

		if (host === API_SPEC_HOST) {
			return this.#getApiSpecResolver().resolve(url);
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
		const syntheticEntry = `- [${ABOUT_ROUTE}](${SCHEME_PREFIX}${ABOUT_ROUTE}) — identity and build fingerprint`;
		const apiSpecEntry = `- [${API_SPEC_HOST}/](${SCHEME_PREFIX}${API_SPEC_HOST}/) — F5 XC API specifications (${specs.index.domains.length} domains, v${specs.version})`;
		const listing = [
			syntheticEntry,
			apiSpecEntry,
			...EMBEDDED_DOC_FILENAMES.map(f => `- [${f}](${SCHEME_PREFIX}${f})`),
		].join("\n");
		const totalCount = EMBEDDED_DOC_FILENAMES.length + 2;
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
