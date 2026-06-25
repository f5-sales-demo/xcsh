import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface XCSHContextData {
	name: string;
	apiUrl: string;
	apiToken: string;
	defaultNamespace: string;
	env?: Record<string, string>;
	sensitiveKeys?: string[];
	knowledgeSources?: KnowledgeSource[];
	includeSkills?: string[];
	excludeSkills?: string[];
	version?: number;
	metadata?: {
		createdAt?: string;
		expiresAt?: string;
		lastRotatedAt?: string;
		rotateAfterDays?: number;
	};
}

export interface KnowledgeSource {
	url: string;
	label?: string;
	type?: "llms-txt" | "skill-dir" | "docs-site";
}

export interface ContextOverrides {
	defaultNamespace?: string;
	env?: Record<string, string>;
	sensitiveKeys?: string[];
	knowledgeSources?: KnowledgeSource[];
	includeSkills?: string[];
	excludeSkills?: string[];
}

export interface PointerContext {
	context: string;
	overrides?: ContextOverrides;
}

export type ContextSource = "env" | "local" | "global";

export interface ResolvedContext {
	context: XCSHContextData;
	source: ContextSource;
	sourcePath: string;
}

/**
 * Host-supplied path helpers. xcsh injects the `dirs.ts` family; the VS Code
 * extension injects its `contextPaths.ts` family. Keeping the resolver free of a
 * direct `dirs.ts` import keeps this module runtime-agnostic (no Bun globals, no
 * JSON imports) so it bundles cleanly into the VS Code extension via webpack.
 */
export interface ContextPathProvider {
	getContextsDir(): string;
	getActiveContextPath(): string;
	getContextPath(name: string): string;
	getLocalContextsDir(cwd: string): string;
	getLocalActiveContextPath(cwd: string): string;
	getLocalContextPath(name: string, cwd: string): string;
}

export type GitTracker = (filePath: string) => Promise<boolean>;

export interface ResolverDeps {
	paths: ContextPathProvider;
	/** Optional override; defaults to a `node:child_process` implementation that runs under both Bun and Node. */
	gitTracker?: GitTracker;
}

export function isPointerContext(data: unknown): data is PointerContext {
	if (data === null || data === undefined || typeof data !== "object") return false;
	const obj = data as Record<string, unknown>;
	return typeof obj.context === "string" && !("apiUrl" in obj);
}

export function isInlineContext(data: unknown): boolean {
	if (data === null || data === undefined || typeof data !== "object") return false;
	const obj = data as Record<string, unknown>;
	return typeof obj.apiUrl === "string";
}

export function validateLocalContextFile(data: unknown): { valid: boolean; error?: string } {
	if (data === null || data === undefined || typeof data !== "object") {
		return { valid: false, error: "Context file must be a JSON object" };
	}
	const obj = data as Record<string, unknown>;
	const hasContext = typeof obj.context === "string";
	const hasApiUrl = typeof obj.apiUrl === "string";

	if (hasContext && hasApiUrl) {
		return { valid: false, error: "Context file cannot have both 'context' (pointer) and 'apiUrl' (inline) fields" };
	}
	if (!hasContext && !hasApiUrl) {
		return { valid: false, error: "Context file must have either 'context' (pointer) or 'apiUrl' (inline) field" };
	}
	return { valid: true };
}

export function mergePointerOverrides(base: XCSHContextData, overrides: ContextOverrides): XCSHContextData {
	const merged = { ...base };

	if (overrides.defaultNamespace !== undefined) {
		merged.defaultNamespace = overrides.defaultNamespace;
	}
	if (overrides.sensitiveKeys !== undefined) {
		merged.sensitiveKeys = overrides.sensitiveKeys;
	}
	if (overrides.knowledgeSources !== undefined) {
		merged.knowledgeSources = overrides.knowledgeSources;
	}
	if (overrides.includeSkills !== undefined) {
		merged.includeSkills = overrides.includeSkills;
	}
	if (overrides.excludeSkills !== undefined) {
		merged.excludeSkills = overrides.excludeSkills;
	}
	if (overrides.env !== undefined) {
		merged.env = { ...base.env, ...overrides.env };
	}

	return merged;
}

/**
 * Subcommand names that must not be usable as context names — otherwise
 * `/context <name>` could not disambiguate a switch from a subcommand. Single
 * source of truth shared by both the resolver and the coding agent.
 */
export const RESERVED_CONTEXT_NAMES = new Set([
	"list",
	"show",
	"status",
	"create",
	"delete",
	"rename",
	"namespace",
	"env",
	"set",
	"unset",
	"add",
	"remove",
	"clear",
	"activate",
	"validate",
	"export",
	"import",
	"wizard",
	"help",
	"link",
	"unlink",
]);

const CONTEXT_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function isSafeContextName(name: string): boolean {
	if (!CONTEXT_NAME_RE.test(name)) return false;
	return !RESERVED_CONTEXT_NAMES.has(name.toLowerCase());
}

/**
 * Normalize an API URL for safe path joining by stripping trailing slash(es).
 *
 * The shared resource library joins URLs by raw concatenation
 * (`${apiUrl}${path}`) where path templates begin with `/api/...`. A trailing
 * slash produces `https://host/api//api/...`; after the transport strips the
 * base URL the remainder begins with `//`, which `new URL()` parses as a
 * protocol-relative authority — collapsing the host to a bare label and breaking
 * TLS altname verification. Stripping trailing slashes prevents this.
 */
export function normalizeApiUrl(apiUrl: string): string {
	return typeof apiUrl === "string" ? apiUrl.replace(/\/+$/, "") : apiUrl;
}

function defaultGitTracker(filePath: string): Promise<boolean> {
	try {
		const dir = path.dirname(filePath);
		const res = spawnSync("git", ["ls-files", "--error-unmatch", filePath], {
			cwd: dir,
			stdio: "ignore",
		});
		return Promise.resolve(res.status === 0);
	} catch {
		return Promise.resolve(false);
	}
}

export class ContextResolver {
	readonly #paths: ContextPathProvider;
	readonly #gitTracker: GitTracker;

	constructor(deps: ResolverDeps) {
		this.#paths = deps.paths;
		this.#gitTracker = deps.gitTracker ?? defaultGitTracker;
	}

	resolve(cwd: string): Promise<ResolvedContext | null> {
		// Priority 1: environment variables
		const envUrl = process.env.XCSH_API_URL;
		const envToken = process.env.XCSH_API_TOKEN;
		if (envUrl && envToken) {
			return Promise.resolve(
				this.#finalize(
					{
						name: "(env)",
						apiUrl: envUrl,
						apiToken: envToken,
						defaultNamespace: process.env.XCSH_NAMESPACE ?? "system",
					},
					"env",
					"environment variables",
				),
			);
		}

		// Priority 2: local .xcsh/contexts/
		const localDir = this.findLocalContextsDir(cwd);
		if (localDir) {
			const localResult = this.#resolveFromDir("local", cwd);
			if (localResult) return Promise.resolve(localResult);
		}

		// Priority 3: global ~/.config/xcsh/contexts/
		return Promise.resolve(this.#resolveGlobal());
	}

	findLocalContextsDir(cwd: string): string | null {
		const dir = this.#paths.getLocalContextsDir(cwd);
		return fs.existsSync(dir) ? dir : null;
	}

	checkGitTracking(filePath: string): Promise<boolean> {
		return this.#gitTracker(filePath);
	}

	#resolveFromDir(source: ContextSource, cwd: string): ResolvedContext | null {
		const activeContextPath =
			source === "local" ? this.#paths.getLocalActiveContextPath(cwd) : this.#paths.getActiveContextPath();

		const activeName = this.#readActivePointer(activeContextPath);
		if (!activeName || !isSafeContextName(activeName)) return null;

		const contextPath =
			source === "local" ? this.#paths.getLocalContextPath(activeName, cwd) : this.#paths.getContextPath(activeName);

		const data = this.#readJsonFile(contextPath);
		if (!data) return null;

		const validation = validateLocalContextFile(data);
		if (!validation.valid) return null;

		if (isPointerContext(data)) {
			return this.#resolvePointer(data, contextPath);
		}

		if (isInlineContext(data)) {
			const obj = data as Record<string, unknown>;
			if (
				typeof obj.name !== "string" ||
				typeof obj.apiToken !== "string" ||
				typeof obj.defaultNamespace !== "string"
			) {
				return null;
			}
			return this.#finalize(data as unknown as XCSHContextData, source, contextPath);
		}

		return null;
	}

	#resolveGlobal(): ResolvedContext | null {
		const globalContextsDir = this.#paths.getContextsDir();
		if (!fs.existsSync(globalContextsDir)) return null;
		return this.#resolveFromDir("global", "");
	}

	#resolvePointer(pointer: PointerContext, pointerPath: string): ResolvedContext | null {
		if (!isSafeContextName(pointer.context)) return null;
		const globalPath = this.#paths.getContextPath(pointer.context);
		const globalData = this.#readJsonFile(globalPath);
		if (!globalData) return null;

		let resolved = globalData as unknown as XCSHContextData;
		if (pointer.overrides) {
			resolved = mergePointerOverrides(resolved, pointer.overrides);
		}

		// A pointer always resolves through the local tier, so report "local".
		return this.#finalize(resolved, "local", pointerPath);
	}

	/** Stamp source/path and normalize the resolved apiUrl uniformly across all sources. */
	#finalize(context: XCSHContextData, source: ContextSource, sourcePath: string): ResolvedContext {
		const normalized =
			typeof context.apiUrl === "string" ? { ...context, apiUrl: normalizeApiUrl(context.apiUrl) } : context;
		return { context: normalized, source, sourcePath };
	}

	#readActivePointer(filePath: string): string | null {
		if (!fs.existsSync(filePath)) return null;
		try {
			const name = fs.readFileSync(filePath, "utf-8").trim();
			return name || null;
		} catch {
			return null;
		}
	}

	#readJsonFile(filePath: string): Record<string, unknown> | null {
		if (!fs.existsSync(filePath)) return null;
		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			return JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return null;
		}
	}
}
