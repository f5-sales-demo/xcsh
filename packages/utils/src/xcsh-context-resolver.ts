import * as fs from "node:fs";
import * as path from "node:path";
import {
	getLocalXCSHActiveContextPath,
	getLocalXCSHContextPath,
	getLocalXCSHContextsDir,
	getXCSHActiveContextPath,
	getXCSHContextPath,
	getXCSHContextsDir,
} from "./dirs";

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

const CONTEXT_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function isSafeContextName(name: string): boolean {
	return CONTEXT_NAME_RE.test(name);
}

export class ContextResolver {
	resolve(cwd: string): Promise<ResolvedContext | null> {
		// Priority 1: environment variables
		const envUrl = process.env.XCSH_API_URL;
		const envToken = process.env.XCSH_API_TOKEN;
		if (envUrl && envToken) {
			return Promise.resolve({
				context: {
					name: "(env)",
					apiUrl: envUrl,
					apiToken: envToken,
					defaultNamespace: process.env.XCSH_NAMESPACE ?? "system",
				},
				source: "env",
				sourcePath: "environment variables",
			});
		}

		// Priority 2: local .xcsh/contexts/
		const localDir = this.findLocalContextsDir(cwd);
		if (localDir) {
			const localResult = this.#resolveFromDir(localDir, "local", cwd);
			if (localResult) return Promise.resolve(localResult);
		}

		// Priority 3: global ~/.config/xcsh/contexts/
		const globalResult = this.#resolveGlobal();
		return Promise.resolve(globalResult);
	}

	findLocalContextsDir(cwd: string): string | null {
		const dir = getLocalXCSHContextsDir(cwd);
		return fs.existsSync(dir) ? dir : null;
	}

	async checkGitTracking(filePath: string): Promise<boolean> {
		try {
			const dir = path.dirname(filePath);
			const proc = Bun.spawn(["git", "ls-files", "--error-unmatch", filePath], {
				cwd: dir,
				stdout: "ignore",
				stderr: "ignore",
			});
			const code = await proc.exited;
			return code === 0;
		} catch {
			return false;
		}
	}

	#resolveFromDir(_contextsDir: string, source: ContextSource, cwd: string): ResolvedContext | null {
		const activeContextPath = source === "local" ? getLocalXCSHActiveContextPath(cwd) : getXCSHActiveContextPath();

		const activeName = this.#readActivePointer(activeContextPath);
		if (!activeName || !isSafeContextName(activeName)) return null;

		const contextPath =
			source === "local" ? getLocalXCSHContextPath(activeName, cwd) : getXCSHContextPath(activeName);

		const data = this.#readJsonFile(contextPath);
		if (!data) return null;

		const validation = validateLocalContextFile(data);
		if (!validation.valid) return null;

		if (isPointerContext(data)) {
			return this.#resolvePointer(data, contextPath, cwd);
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
			return {
				context: data as unknown as XCSHContextData,
				source,
				sourcePath: contextPath,
			};
		}

		return null;
	}

	#resolveGlobal(): ResolvedContext | null {
		const globalContextsDir = getXCSHContextsDir();
		if (!fs.existsSync(globalContextsDir)) return null;
		return this.#resolveFromDir(globalContextsDir, "global", "");
	}

	#resolvePointer(pointer: PointerContext, pointerPath: string, _cwd: string): ResolvedContext | null {
		if (!isSafeContextName(pointer.context)) return null;
		const globalPath = getXCSHContextPath(pointer.context);
		const globalData = this.#readJsonFile(globalPath);
		if (!globalData) return null;

		let resolved = globalData as unknown as XCSHContextData;
		if (pointer.overrides) {
			resolved = mergePointerOverrides(resolved, pointer.overrides);
		}

		return {
			context: resolved,
			source: "local",
			sourcePath: pointerPath,
		};
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
