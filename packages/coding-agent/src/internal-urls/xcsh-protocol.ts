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
 */
import * as path from "node:path";
import { getRuntimeBuildInfo, type RuntimeBuildInfo, renderAboutDoc } from "./build-info-runtime";
import { EMBEDDED_DOC_FILENAMES, EMBEDDED_DOCS } from "./docs-index.generated";
import type { InternalResource, InternalUrl, ProtocolHandler } from "./types";

const SCHEME_PREFIX = "xcsh://";
const ABOUT_ROUTE = "about";

export interface InternalDocsProtocolOptions {
	/** Override runtime build-info resolution. Primarily for tests. */
	readonly resolveBuildInfo?: () => Promise<RuntimeBuildInfo>;
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

	constructor(options: InternalDocsProtocolOptions = {}) {
		this.#resolveBuildInfo = options.resolveBuildInfo ?? getRuntimeBuildInfo;
	}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const host = url.rawHost || url.hostname;
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

		const syntheticEntry = `- [${ABOUT_ROUTE}](${SCHEME_PREFIX}${ABOUT_ROUTE}) — identity and build fingerprint`;
		const listing = [syntheticEntry, ...EMBEDDED_DOC_FILENAMES.map(f => `- [${f}](${SCHEME_PREFIX}${f})`)].join("\n");
		const totalCount = EMBEDDED_DOC_FILENAMES.length + 1;
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
			const content = renderAboutDoc(info);
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
