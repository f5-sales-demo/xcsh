/**
 * Generic resolver for xcsh://plugin/<name>/... URLs.
 *
 * Framework-agnostic: it reads a plugin-declared manifest
 * (.xcsh-plugin/resources.json) and maps declared keys to files on disk. It has
 * NO knowledge of any specific plugin's domain.
 *
 * URL forms (host = "plugin", first path segment = plugin name):
 * - xcsh://plugin                       -> list installed plugins
 * - xcsh://plugin/<name>                -> plugin summary (version, declared keys)
 * - xcsh://plugin/<name>/contract       -> the manifest verbatim
 * - xcsh://plugin/<name>/schema         -> file at manifest key "schema"
 * - xcsh://plugin/<name>/engine         -> manifest engine block, entry resolved to abs path
 * - xcsh://plugin/<name>/file/<relpath> -> any root-relative file
 *
 * Text resources resolve to their CONTENTS. A declared binary resource (a .xlsx
 * template, an image) resolves to its LOCATION — `{binary, path, bytes}` — because a
 * UTF-8 read would corrupt it and its bytes are useless in a prompt regardless.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { validateRelativePath } from "./skill-protocol";
import type { InternalResource, InternalUrl } from "./types";

/** Minimal shape the resolver needs from a discovered plugin root. */
export interface PluginRootLike {
	plugin: string;
	version: string;
	path: string;
}

export type GetPluginRoots = () => Promise<readonly PluginRootLike[]>;

/** Manifest location, relative to a plugin root. */
export const PLUGIN_MANIFEST_RELPATH = ".xcsh-plugin/resources.json";

interface EngineBlock {
	runtime?: string;
	entry?: string;
	commands?: string[];
}

interface ResourcesManifest {
	engine?: EngineBlock;
	[key: string]: unknown;
}

function contentTypeFor(filePath: string): InternalResource["contentType"] {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".json") return "application/json";
	if (ext === ".md") return "text/markdown";
	return "text/plain";
}

/**
 * Extensions a plugin may legitimately declare that are NOT text.
 *
 * Reading one as UTF-8 corrupts it, and nobody wants 91 KB of mangled bytes in a prompt
 * either — the MEDDPICC plugin's `meddpicc-template.xlsx` is exactly that size. What a
 * caller needs is where the file is, so it can be copied, opened, or handed to a tool
 * that understands the format; so a binary resource resolves to its location, not its
 * contents. Deliberately a small allow-list of formats plugins actually ship rather than
 * content sniffing, so the decision is inspectable.
 */
const BINARY_EXTENSIONS = new Set([
	".xlsx",
	".xls",
	".xlsm",
	".docx",
	".doc",
	".pptx",
	".ppt",
	".pdf",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".zip",
	".gz",
	".tgz",
	".woff",
	".woff2",
	".ico",
]);

function isBinaryResource(filePath: string): boolean {
	return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** realpath that tolerates a missing leaf by resolving the nearest existing ancestor. */
async function realpathAllowingMissing(p: string): Promise<string> {
	try {
		return await fs.realpath(p);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
		const parent = path.dirname(p);
		if (parent === p) throw err;
		const realParent = await realpathAllowingMissing(parent);
		return path.join(realParent, path.basename(p));
	}
}

/** Join a root-relative path safely inside the plugin root; throws on traversal (incl. via symlink). */
async function safeJoin(root: string, relativePath: string): Promise<string> {
	try {
		validateRelativePath(relativePath);
	} catch {
		// validateRelativePath's message names skill:// URLs; re-throw with the correct scheme.
		throw new Error("Path traversal (..) or absolute paths are not allowed in xcsh://plugin/ URLs");
	}
	const lexicalTarget = path.resolve(path.join(root, relativePath));
	const resolvedRoot = await fs.realpath(root);
	const realTarget = await realpathAllowingMissing(path.join(resolvedRoot, relativePath));
	if (realTarget !== resolvedRoot && !realTarget.startsWith(resolvedRoot + path.sep)) {
		throw new Error("Path traversal is not allowed in xcsh://plugin/ URLs");
	}
	return lexicalTarget;
}

export class PluginResolver {
	constructor(private readonly getPluginRoots: GetPluginRoots) {}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		// rawPathname preserves traversal markers; strip leading slash.
		const rawPath = (url.rawPathname ?? url.pathname ?? "").replace(/^\/+/, "");
		const segments = rawPath ? rawPath.split("/").map(s => decodeURIComponent(s)) : [];

		const roots = await this.getPluginRoots();

		// xcsh://plugin -> list installed plugins
		if (segments.length === 0) {
			return this.#json(url, await this.#listPlugins(roots));
		}

		const name = segments[0];
		const root = roots.find(r => r.plugin === name);
		if (!root) {
			const installed = roots.map(r => r.plugin).join(", ") || "none";
			throw new Error(`Plugin not installed: ${name}\nInstalled: ${installed}`);
		}

		const selector = segments.slice(1);

		// xcsh://plugin/<name> -> summary
		if (selector.length === 0) {
			const manifest = await this.#readManifest(root.path);
			return this.#json(url, {
				name: root.plugin,
				version: root.version,
				resources: Object.keys(manifest),
			});
		}

		const kind = selector[0];

		if (kind === "contract") {
			const manifestPath = path.join(root.path, PLUGIN_MANIFEST_RELPATH);
			const content = await this.#readFile(manifestPath);
			return {
				url: url.href,
				content,
				contentType: "application/json",
				size: Buffer.byteLength(content, "utf-8"),
				sourcePath: manifestPath,
				notes: [],
			};
		}

		if (kind === "engine") {
			const manifest = await this.#readManifest(root.path);
			const engine = manifest.engine;
			if (!engine?.entry) {
				throw new Error(`Plugin ${name} declares no engine.entry in ${PLUGIN_MANIFEST_RELPATH}`);
			}
			const entryPath = await safeJoin(root.path, engine.entry);
			await this.#assertExists(entryPath);
			const body = JSON.stringify({
				runtime: engine.runtime ?? null,
				entry: engine.entry,
				entryPath,
				commands: engine.commands ?? [],
			});
			return {
				url: url.href,
				content: body,
				contentType: "application/json",
				size: Buffer.byteLength(body, "utf-8"),
				sourcePath: entryPath,
				notes: [],
			};
		}

		if (kind === "file") {
			const relativePath = selector.slice(1).join("/");
			if (!relativePath) throw new Error("xcsh://plugin/<name>/file/ requires a relative path");
			const target = await safeJoin(root.path, relativePath);
			return await this.#resource(url, target);
		}

		// Named resource key from the manifest (e.g. "schema", "example").
		const manifest = await this.#readManifest(root.path);
		const value = manifest[kind];
		if (typeof value !== "string") {
			const keys = Object.keys(manifest).filter(k => typeof manifest[k] === "string");
			throw new Error(`Unknown resource "${kind}" for plugin ${name}\nAvailable: ${keys.join(", ") || "none"}`);
		}
		const target = await safeJoin(root.path, value);
		return await this.#resource(url, target);
	}

	/**
	 * Resolve one on-disk file, as contents for text and as a locator for binary.
	 * Shared by the `file/<relpath>` route and the named-key route so the two cannot
	 * disagree about what a `.xlsx` is.
	 */
	async #resource(url: InternalUrl, target: string): Promise<InternalResource> {
		if (isBinaryResource(target)) {
			const file = Bun.file(target);
			if (!(await file.exists())) throw new Error(`File not found: ${target}`);
			const body = JSON.stringify({ binary: true, path: target, bytes: file.size });
			return {
				url: url.href,
				content: body,
				contentType: "application/json",
				size: Buffer.byteLength(body, "utf-8"),
				sourcePath: target,
				notes: ["Binary resource: this is its location, not its bytes. Open or copy it with a tool."],
			};
		}
		const content = await this.#readFile(target);
		return {
			url: url.href,
			content,
			contentType: contentTypeFor(target),
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: target,
			notes: [],
		};
	}

	async #listPlugins(
		roots: readonly PluginRootLike[],
	): Promise<Array<{ name: string; version: string; hasContract: boolean }>> {
		const out: Array<{ name: string; version: string; hasContract: boolean }> = [];
		for (const r of roots) {
			const manifestPath = path.join(r.path, PLUGIN_MANIFEST_RELPATH);
			const hasContract = await Bun.file(manifestPath).exists();
			out.push({ name: r.plugin, version: r.version, hasContract });
		}
		return out;
	}

	async #readManifest(root: string): Promise<ResourcesManifest> {
		const manifestPath = path.join(root, PLUGIN_MANIFEST_RELPATH);
		const file = Bun.file(manifestPath);
		if (!(await file.exists())) {
			throw new Error(`Plugin manifest not found: ${manifestPath} (expected ${PLUGIN_MANIFEST_RELPATH})`);
		}
		return JSON.parse(await file.text()) as ResourcesManifest;
	}

	async #readFile(absPath: string): Promise<string> {
		const file = Bun.file(absPath);
		if (!(await file.exists())) throw new Error(`File not found: ${absPath}`);
		return file.text();
	}

	async #assertExists(absPath: string): Promise<void> {
		if (!(await Bun.file(absPath).exists())) throw new Error(`File not found: ${absPath}`);
	}

	#json(url: InternalUrl, data: unknown): InternalResource {
		const content = JSON.stringify(data);
		return {
			url: url.href,
			content,
			contentType: "application/json",
			size: Buffer.byteLength(content, "utf-8"),
			notes: [],
		};
	}
}

export function createPluginResolver(getPluginRoots: GetPluginRoots): PluginResolver {
	return new PluginResolver(getPluginRoots);
}
