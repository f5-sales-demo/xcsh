import * as fs from "node:fs";
import * as path from "node:path";
import { getF5XCConfigDir, logger } from "@f5xc-salesdemos/pi-utils";
import { Settings } from "../config/settings";
import { SECRET_ENV_PATTERNS } from "../secrets/index";
import { F5XCApiClient } from "./f5xc-api-client";
import {
	deriveTenantFromUrl,
	F5XC_API_TOKEN,
	F5XC_API_URL,
	F5XC_NAMESPACE,
	F5XC_TENANT,
	hasEnvOverride,
	RESERVED_ENV_KEYS,
	RESERVED_ENV_MESSAGES,
} from "./f5xc-env";

export const CURRENT_SCHEMA_VERSION = 1;

export const CURRENT_EXPORT_VERSION = 1;

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
]);

export interface ExportBundle {
	/** Export format version — distinct from per-context F5XCContext.version (schema version). */
	version: number;
	exportedAt: string;
	/** When true, importContexts rejects this bundle. */
	tokensMasked: boolean;
	/** Same shape as on-disk context JSON. Tokens masked iff tokensMasked=true. */
	contexts: F5XCContext[];
}

export interface ImportResult {
	imported: string[];
	overwritten: string[];
	skipped: string[];
}

export interface KnowledgeSource {
	url: string;
	label?: string;
	type?: "llms-txt" | "skill-dir" | "docs-site";
}

export interface F5XCContext {
	name: string;
	apiUrl: string;
	apiToken: string;
	defaultNamespace: string;
	env?: Record<string, string>;
	/** Env var names from `env` whose values should be masked in output (e.g. ["F5XC_USERNAME"]). */
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

export type AuthStatus = "connected" | "auth_error" | "offline" | "unknown";

export type TokenHealth = "ok" | "expiring" | "expired";

export interface ContextStatus {
	activeContextName: string | null;
	activeContextUrl: string | null;
	activeContextTenant: string | null;
	activeContextNamespace: string | null;
	credentialSource: "context" | "environment" | "mixed" | "none";
	authStatus: AuthStatus;
	isConfigured: boolean;
	/** Milliseconds measured by the most recent validateToken() call. Absent if validateToken has not run. */
	authLatencyMs?: number;
	/** Epoch ms of the most recent validateToken() call. Absent if validateToken has not run. */
	authCheckedAt?: number;
	tokenHealth?: TokenHealth;
}

/**
 * Result of validating credentials for a named context without activating it.
 * Returned by `ContextService.validateContextByName()`. Callers get the full
 * context back rather than correlating by name so rendering code can use a
 * single object (tenant, URL, masked token, status) without a second lookup.
 *
 * Auth failure is carried here as `status: "auth_error" | "offline"` with
 * optional `errorClass` — not thrown. The method throws only for missing /
 * invalid-name / incompatible-version cases.
 */
export interface ValidationResult {
	context: F5XCContext;
	status: AuthStatus;
	latencyMs?: number;
	errorClass?: "network" | "credential" | "url_not_found";
}

export class ContextError extends Error {
	constructor(
		message: string,
		readonly contextName?: string,
	) {
		super(message);
		this.name = "ContextError";
	}
}

export class ContextService {
	static #instance: ContextService | null = null;
	static #onContextChangeListeners: Array<(context: F5XCContext) => void> = [];
	static #onAuthStatusChangeListeners: Array<(prev: AuthStatus, current: AuthStatus) => void> = [];
	static #onTokenHealthChangeListeners: Array<(prev: TokenHealth, current: TokenHealth) => void> = [];

	/** Register a callback invoked after a context is activated or its settings applied. */
	static onContextChange(cb: (context: F5XCContext) => void): void {
		ContextService.#onContextChangeListeners.push(cb);
	}

	/**
	 * Remove a previously-registered context-change callback. No-op if the callback isn't registered.
	 * Call on session disposal to prevent leaked listeners from mutating dead session state.
	 */
	static offContextChange(cb: (context: F5XCContext) => void): void {
		const idx = ContextService.#onContextChangeListeners.indexOf(cb);
		if (idx >= 0) ContextService.#onContextChangeListeners.splice(idx, 1);
	}

	static onAuthStatusChange(cb: (prev: AuthStatus, current: AuthStatus) => void): void {
		ContextService.#onAuthStatusChangeListeners.push(cb);
	}

	static offAuthStatusChange(cb: (prev: AuthStatus, current: AuthStatus) => void): void {
		const idx = ContextService.#onAuthStatusChangeListeners.indexOf(cb);
		if (idx >= 0) ContextService.#onAuthStatusChangeListeners.splice(idx, 1);
	}

	static onTokenHealthChange(cb: (prev: TokenHealth, current: TokenHealth) => void): void {
		ContextService.#onTokenHealthChangeListeners.push(cb);
	}

	static offTokenHealthChange(cb: (prev: TokenHealth, current: TokenHealth) => void): void {
		const idx = ContextService.#onTokenHealthChangeListeners.indexOf(cb);
		if (idx >= 0) ContextService.#onTokenHealthChangeListeners.splice(idx, 1);
	}

	#configDir: string;
	#activeContext: F5XCContext | null = null;
	#credentialSource: ContextStatus["credentialSource"] = "none";
	#authStatus: AuthStatus = "unknown";
	#contextsCache: F5XCContext[] = [];
	#namespacesCache: string[] = [];
	/** Incremented on every `activate()`. Fire-and-forget namespace body-parses snapshot
	 * this at fetch time and discard the result if it has advanced — prevents a stale
	 * in-flight response from overwriting the cache after the active context changed. */
	#activationEpoch = 0;
	#lastAuthLatencyMs: number | undefined;
	#lastAuthCheckedAt: number | undefined;
	#apiClient: F5XCApiClient | null = null;
	#revalidationTimer: NodeJS.Timeout | null = null;
	#lastTokenHealth: TokenHealth = "ok";
	#previousContextName: string | null = null;

	private constructor(configDir: string) {
		this.#configDir = configDir;
	}

	#refreshApiClient(context: F5XCContext): void {
		this.#apiClient = new F5XCApiClient({
			apiUrl: context.apiUrl,
			apiToken: process.env[F5XC_API_TOKEN] ?? context.apiToken,
		});
		if (!hasEnvOverride()) {
			this.#populateNamespaceCache();
		}
		this.startRevalidation();
		this.#lastTokenHealth = "ok";
	}

	getApiClient(): F5XCApiClient | null {
		return this.#apiClient;
	}

	startRevalidation(intervalMs = 300_000): void {
		this.stopRevalidation();
		const tick = async () => {
			const previousStatus = this.#authStatus;
			await this.validateToken();
			if (this.#authStatus !== previousStatus) {
				for (const cb of ContextService.#onAuthStatusChangeListeners) {
					try {
						cb(previousStatus, this.#authStatus);
					} catch {}
				}
			}
			if (this.#authStatus === "connected" && this.#namespacesCache.length === 0 && !hasEnvOverride()) {
				this.#populateNamespaceCache();
			}
			const prevHealth = this.#lastTokenHealth;
			const currentHealth = this.#computeTokenHealth();
			if (currentHealth !== prevHealth) {
				this.#lastTokenHealth = currentHealth;
				for (const cb of ContextService.#onTokenHealthChangeListeners) {
					try {
						cb(prevHealth, currentHealth);
					} catch {}
				}
			}
			if (this.#revalidationTimer !== null) {
				this.#revalidationTimer = setTimeout(tick, intervalMs);
				this.#revalidationTimer.unref?.();
			}
		};
		this.#revalidationTimer = setTimeout(tick, intervalMs);
		this.#revalidationTimer.unref?.();
	}

	stopRevalidation(): void {
		if (this.#revalidationTimer) {
			clearTimeout(this.#revalidationTimer);
			this.#revalidationTimer = null;
		}
	}

	#computeTokenHealth(): TokenHealth {
		const expiresAt = this.#activeContext?.metadata?.expiresAt;
		if (!expiresAt) return "ok";
		const diffMs = new Date(expiresAt).getTime() - Date.now();
		if (diffMs <= 0) return "expired";
		if (diffMs <= 7 * 86_400_000) return "expiring";
		return "ok";
	}

	#populateNamespaceCache(): void {
		const epochAtFetch = this.#activationEpoch;
		const client = this.#apiClient;
		if (!client) return;
		client
			.listNamespaces()
			.then(namespaces => {
				if (this.#activationEpoch !== epochAtFetch) return;
				this.#namespacesCache = namespaces.map(n => n.name).sort((a, b) => a.localeCompare(b));
			})
			.catch(err => {
				logger.debug("F5XC namespace cache population failed", { error: String(err) });
			});
	}

	static init(configDir: string): ContextService {
		ContextService.#instance = new ContextService(configDir);
		return ContextService.#instance;
	}

	/**
	 * Return the existing instance, or bootstrap one using the provided
	 * configDir (or `getF5XCConfigDir()` if omitted) and run loadActive()
	 * before returning.
	 *
	 * Primary patterns used in-tree:
	 *   - main.ts: CLI startup calls `ContextService.init(dir).loadActive()`
	 *     eagerly — deterministic, synchronous path for the CLI.
	 *   - SDK/embedder paths and slash-command handlers call
	 *     `ContextService.getOrInit()` — returns existing or bootstraps.
	 *   - Synchronous render paths (e.g. status-line segments) call `.instance`
	 *     inside try/catch and silently hide if uninitialized — they MUST NOT
	 *     trigger bootstrapping as a side effect of rendering.
	 *   - welcome-checks.ts reads `.instance` directly after startup has already
	 *     populated the singleton via init().
	 *
	 * No race exists: `init()` is synchronous, so a concurrent caller always
	 * observes the populated singleton before re-entering the null branch.
	 *
	 * @param configDir — seed directory when bootstrapping; ignored when an
	 *   instance already exists.
	 */
	static async getOrInit(configDir?: string): Promise<ContextService> {
		if (ContextService.#instance) return ContextService.#instance;
		const dir = configDir ?? getF5XCConfigDir();
		const service = ContextService.init(dir);
		await service.loadActive();
		return service;
	}

	/**
	 * Return the values of env vars marked as sensitive in the active context.
	 * Safe to call before init — returns empty array if no context is loaded.
	 */
	static getSensitiveContextValues(): string[] {
		const instance = ContextService.#instance;
		if (!instance) return [];
		const context = instance.#activeContext;
		if (!context?.sensitiveKeys?.length || !context.env) return [];
		const values: string[] = [];
		for (const key of context.sensitiveKeys) {
			const value = context.env[key];
			if (value) values.push(value);
		}
		return values;
	}

	static get instance(): ContextService {
		if (!ContextService.#instance) {
			throw new Error("ContextService not initialized. Call ContextService.init() first.");
		}
		return ContextService.#instance;
	}

	static _resetForTest(): void {
		if (ContextService.#instance) {
			ContextService.#instance.#apiClient = null;
			ContextService.#instance.#lastTokenHealth = "ok";
			ContextService.#instance.stopRevalidation();
			ContextService.#instance.#previousContextName = null;
		}
		ContextService.#instance = null;
		// Clear listeners to prevent cross-test contamination. Each createAgentSession() call
		// registers a listener closed over that session's sessionManager; without this reset,
		// listeners from a disposed session persist into the next test and fire on activate().
		ContextService.#onContextChangeListeners = [];
		ContextService.#onAuthStatusChangeListeners = [];
		ContextService.#onTokenHealthChangeListeners = [];
	}

	get previousContextName(): string | null {
		return this.#previousContextName;
	}

	get contextsDir(): string {
		return path.join(this.#configDir, "contexts");
	}

	get activeContextPath(): string {
		return path.join(this.#configDir, "active_context");
	}

	async loadActive(): Promise<F5XCContext | null> {
		// FR-102: F5XC_API_URL is the signal to skip context loading entirely.
		// Subprocesses inherit process.env, so they already see the env vars directly.
		if (process.env[F5XC_API_URL]) {
			this.#credentialSource = "environment";
			return null;
		}

		// Check if config dir exists
		if (!fs.existsSync(this.#configDir)) {
			return null;
		}

		// Seed the context cache so `/context activate <tab>` has data at startup.
		// listContexts is declared async but its body uses fs.readdirSync /
		// readFileSync — the cost is proportional to the number of context files.
		// For typical N ≤ 10 on local disk this is sub-millisecond; contexts are
		// small JSON files. A future refactor to fs.promises + truly async I/O
		// would let startup proceed in parallel with the reads, but the current
		// sync form keeps createContext/deleteContext race-free with no coordination.
		await this.listContexts();

		let contextName = this.#readActiveContextName();

		// FR-104: auto-activate if exactly one context exists
		let autoActivated = false;
		if (!contextName) {
			const contexts = this.#listContextFiles();
			if (contexts.length === 1) {
				contextName = contexts[0].replace(/\.json$/, "");
				autoActivated = true;
			} else {
				return null;
			}
		}

		// Read the context JSON
		const context = this.#readContext(contextName);
		if (!context) {
			return null;
		}

		// Gate: incompatible schema version — log warning and return null (don't crash startup)
		try {
			this.#assertCompatibleVersion(context);
		} catch (err) {
			logger.warn("F5XC: context uses incompatible schema version, skipping", {
				name: contextName,
				error: String(err),
			});
			return null;
		}

		// Only persist active_context after the context validates
		if (autoActivated) {
			this.#atomicWrite(this.activeContextPath, contextName);
			logger.debug("F5XC: auto-activated single context", { name: contextName });
		}

		this.#activeContext = context;
		this.#applyToSettings(context);
		// Detect mixed source: context loaded but some fields come from process.env
		this.#credentialSource = hasEnvOverride() ? "mixed" : "context";
		this.#refreshApiClient(context);
		return context;
	}

	async activate(name: string): Promise<F5XCContext> {
		// Reject activation when env overrides are present — before any I/O
		if (process.env[F5XC_API_URL]) {
			throw new ContextError(
				"Cannot activate: F5XC_API_URL environment variable overrides context. Run `unset F5XC_API_URL` first, or restart without it.",
			);
		}

		// Self-heal: activate called before loadActive ever ran. Populate cache.
		if (this.#contextsCache.length === 0) {
			await this.listContexts();
		}

		this.#validateContextName(name);
		const context = this.#readContext(name);
		if (!context) {
			throw new ContextError(`Context '${name}' not found. Run \`/context list\` to see available contexts.`, name);
		}

		this.#assertCompatibleVersion(context);

		// NFR-402: write active_context first — if it fails, don't update settings
		this.#atomicWrite(this.activeContextPath, name);

		if (this.#activeContext && this.#activeContext.name !== name) {
			this.#previousContextName = this.#activeContext.name;
		}
		this.#activeContext = context;
		this.#applyToSettings(context);
		this.#credentialSource = hasEnvOverride() ? "mixed" : "context";
		this.#namespacesCache = [];
		this.#activationEpoch += 1;

		// Invalidate auth-freshness cache on context switch — the previous context's latency
		// and "checked N min ago" timestamp are stale now that a different tenant is active.
		// Subsequent validateToken() (e.g., from /context status) repopulates these fields.
		this.#authStatus = "unknown";
		this.#lastAuthLatencyMs = undefined;
		this.#lastAuthCheckedAt = undefined;
		this.#refreshApiClient(context);

		return context;
	}

	async activatePrevious(): Promise<F5XCContext> {
		if (!this.#previousContextName) {
			throw new ContextError("No previous context. Switch contexts first with /context activate <name>.");
		}
		return this.activate(this.#previousContextName);
	}

	async listContexts(): Promise<F5XCContext[]> {
		const files = this.#listContextFiles();
		const contexts: F5XCContext[] = [];
		for (const file of files) {
			const name = file.replace(/\.json$/, "");
			// Skip files whose basename doesn't satisfy the context-name contract —
			// they cannot be activated (#validateContextName would reject), so
			// surfacing them in /context list or /context activate <tab> just
			// offers users a selection that the handler will immediately refuse.
			if (!this.#isValidContextName(name)) {
				logger.warn("F5XC context file has invalid name, skipping", { name });
				continue;
			}
			const context = this.#readContext(name);
			if (context) {
				contexts.push(context);
			}
		}
		this.#contextsCache = [...contexts].sort((a, b) => a.name.localeCompare(b.name));
		return [...this.#contextsCache];
	}

	async createContext(context: Omit<F5XCContext, "metadata" | "version">): Promise<void> {
		this.#validateContextName(context.name);
		this.#assertNotReserved(context.name);
		const contextPath = path.join(this.contextsDir, `${context.name}.json`);
		if (fs.existsSync(contextPath)) {
			throw new ContextError(`Context '${context.name}' already exists.`, context.name);
		}
		fs.mkdirSync(this.contextsDir, { recursive: true, mode: 0o700 });
		fs.mkdirSync(this.#configDir, { recursive: true, mode: 0o700 });
		const data: F5XCContext = {
			...context,
			version: CURRENT_SCHEMA_VERSION,
			metadata: { createdAt: new Date().toISOString() },
		};
		const filePayload = {
			$schema:
				"https://raw.githubusercontent.com/f5xc-salesdemos/xcsh/main/packages/coding-agent/src/config/context-schema.json",
			...data,
		} as Record<string, unknown>;
		const tmpPath = `${contextPath}.tmp`;
		fs.writeFileSync(tmpPath, JSON.stringify(filePayload, null, 2), { mode: 0o600 });
		fs.renameSync(tmpPath, contextPath);
		this.#contextsCache = [...this.#contextsCache, data].sort((a, b) => a.name.localeCompare(b.name));
	}

	async deleteContext(name: string): Promise<void> {
		this.#validateContextName(name);
		const contextPath = path.join(this.contextsDir, `${name}.json`);
		if (!fs.existsSync(contextPath)) {
			throw new ContextError(`Context '${name}' not found.`, name);
		}
		fs.unlinkSync(contextPath);
		this.#contextsCache = this.#contextsCache.filter(p => p.name !== name);
		if (this.#previousContextName === name) {
			this.#previousContextName = null;
		}
	}

	/**
	 * Export one or more contexts as an ExportBundle. Contexts are deep-cloned
	 * before any masking to guarantee the in-memory cache (#contextsCache and
	 * #activeContext, which may share references) is never mutated.
	 *
	 * When includeToken is false, apiToken and every env value whose key is in
	 * sensitiveKeys is replaced with the masked form. The envelope's
	 * tokensMasked flag reflects this so importContexts can refuse masked
	 * bundles.
	 *
	 * Throws ContextError when a requested name does not exist on disk.
	 */
	async exportContexts(opts: { names?: string[]; includeToken: boolean }): Promise<ExportBundle> {
		const all = await this.listContexts();
		let selected: F5XCContext[];
		if (opts.names && opts.names.length > 0) {
			const byName = new Map(all.map(p => [p.name, p]));
			selected = [];
			const missing: string[] = [];
			for (const n of opts.names) {
				const p = byName.get(n);
				if (!p) missing.push(n);
				else selected.push(p);
			}
			if (missing.length > 0) {
				throw new ContextError(`Context(s) not found: ${missing.join(", ")}.`, missing[0]);
			}
		} else {
			selected = all;
		}

		// Deep-clone BEFORE masking. maskToken is destructive; mutating cache
		// entries would break subsequent activate/validate/show operations.
		const cloned = selected.map(p => structuredClone(p));

		if (!opts.includeToken) {
			for (const p of cloned) {
				p.apiToken = this.maskToken(p.apiToken);
				if (p.env) {
					// Mask env values whose key is either in sensitiveKeys OR
					// matches SECRET_ENV_PATTERNS. Mirrors the show() handler's
					// masking contract: `setEnvVars` auto-populates sensitiveKeys
					// from the pattern, but contexts edited directly on disk or
					// imported from older formats may have secret-looking keys
					// (e.g. F5XC_CONSOLE_PASSWORD, *_TOKEN, *_SECRET) without
					// `sensitiveKeys` entries. Export must match show() to avoid
					// leaking credentials that show() already masks.
					const sensitive = new Set(p.sensitiveKeys ?? []);
					for (const [k, v] of Object.entries(p.env)) {
						if (sensitive.has(k) || SECRET_ENV_PATTERNS.test(k)) {
							p.env[k] = this.maskToken(v);
						}
					}
				}
			}
		}

		return {
			version: CURRENT_EXPORT_VERSION,
			exportedAt: new Date().toISOString(),
			tokensMasked: !opts.includeToken,
			contexts: cloned,
		};
	}

	/**
	 * Import contexts from a bundle. Validation order is load-bearing:
	 *   1. Envelope schema (object with version/tokensMasked/contexts).
	 *   2. Version match.
	 *   3. tokensMasked: true is rejected — masked tokens would pass write but
	 *      fail runtime auth with a misleading error.
	 *   4. Per-context field-shape via #validateContextShape — any failure
	 *      rejects the whole import; no writes occur.
	 *   5. Conflict detection against a fresh listContexts() read — not the
	 *      in-memory cache, which can miss concurrent-session edits.
	 *   6. Atomic per-file write loop. Each write is atomic individually via
	 *      #atomicWrite, but the overall import is NOT transactional: if the
	 *      Nth of M writes throws, the first N-1 contexts are kept and the
	 *      remainder are not written. Multi-file rollback would require a
	 *      two-phase commit we do not implement; validation steps 1–5 catch
	 *      all foreseeable failures before any write begins.
	 *   7. Cache refresh.
	 */
	async importContexts(bundle: unknown, opts: { overwrite: boolean }): Promise<ImportResult> {
		// 1. Envelope schema
		if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
			throw new ContextError("Import bundle missing required fields: bundle must be an object.");
		}
		const b = bundle as Record<string, unknown>;
		if (typeof b.version !== "number" || typeof b.tokensMasked !== "boolean" || !Array.isArray(b.contexts)) {
			throw new ContextError(
				"Import bundle missing required fields: expected { version: number, tokensMasked: boolean, contexts: array }.",
			);
		}

		// 2. Version
		if (b.version !== CURRENT_EXPORT_VERSION) {
			throw new ContextError(
				`Import bundle uses export version ${b.version}, but this version of xcsh only supports ${CURRENT_EXPORT_VERSION}.`,
			);
		}

		// 3. Masked-token gate
		if (b.tokensMasked === true) {
			throw new ContextError(
				"Bundle contains masked tokens. Re-export with --include-token to produce an importable bundle.",
			);
		}

		// 4. Per-context field-shape
		const rawContexts = b.contexts as unknown[];
		const normalized: F5XCContext[] = [];
		const badNames: string[] = [];
		for (let i = 0; i < rawContexts.length; i++) {
			const raw = rawContexts[i];
			const rawObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
			const name = typeof rawObj.name === "string" ? rawObj.name : `<entry ${i}>`;
			if (typeof rawObj.name !== "string" || !this.#isValidContextName(rawObj.name)) {
				badNames.push(`${name} (invalid name)`);
				continue;
			}
			if (RESERVED_CONTEXT_NAMES.has(rawObj.name.toLowerCase())) {
				badNames.push(`${rawObj.name} (reserved subcommand name)`);
				continue;
			}
			const shape = this.#validateContextShape(raw, rawObj.name);
			if (!shape) {
				badNames.push(`${rawObj.name} (invalid shape)`);
				continue;
			}
			normalized.push(shape);
		}
		if (badNames.length > 0) {
			throw new ContextError(`Import bundle has ${badNames.length} invalid context(s): ${badNames.join(", ")}.`);
		}

		// 4.5. Per-context schema-version compatibility. The envelope version
		// (step 2) is the bundle format; `context.version` is the per-context
		// schema version. Without this check a bundle produced by a newer xcsh
		// (version: 2) would pass shape checks and reach the write loop,
		// leaving unusable contexts on disk that activate/loadActive reject.
		// In the overwrite-active path that would mean the active context is
		// silently bricked on the next startup. Reject upfront.
		const incompatibleNames: string[] = [];
		for (const p of normalized) {
			if (p.version !== undefined && p.version > CURRENT_SCHEMA_VERSION) {
				incompatibleNames.push(`${p.name} (v${p.version})`);
			}
		}
		if (incompatibleNames.length > 0) {
			throw new ContextError(
				`Import bundle has ${incompatibleNames.length} context(s) with incompatible schema version (this xcsh supports v${CURRENT_SCHEMA_VERSION}): ${incompatibleNames.join(", ")}. Upgrade xcsh to import this bundle.`,
			);
		}

		// 4.6. Intra-bundle duplicate-name rejection. A bundle listing the
		// same name twice would silently clobber the first entry in the write
		// loop and emit misleading duplicated names in `imported[]`. Reject
		// before any write so the user can fix the malformed bundle.
		const seen = new Set<string>();
		const intraDuplicates = new Set<string>();
		for (const p of normalized) {
			if (seen.has(p.name)) intraDuplicates.add(p.name);
			else seen.add(p.name);
		}
		if (intraDuplicates.size > 0) {
			throw new ContextError(
				`Import bundle contains duplicate context name(s): ${[...intraDuplicates].join(", ")}. Each name must appear at most once.`,
			);
		}

		// 5. Conflict detection — fresh disk read, NOT listContextNamesCached
		const existing = await this.listContexts();
		const existingNames = new Set(existing.map(p => p.name));
		const conflicts = normalized.filter(p => existingNames.has(p.name)).map(p => p.name);
		if (conflicts.length > 0 && !opts.overwrite) {
			throw new ContextError(
				`${conflicts.length} context(s) conflict: ${conflicts.join(", ")}. Re-run with --overwrite to replace, or delete conflicts first.`,
			);
		}

		// 6. Write loop — atomic per-file
		fs.mkdirSync(this.contextsDir, { recursive: true, mode: 0o700 });
		const imported: string[] = [];
		const overwritten: string[] = [];
		for (const context of normalized) {
			const filePath = path.join(this.contextsDir, `${context.name}.json`);
			const wasExisting = existingNames.has(context.name);
			const payload: F5XCContext = {
				...context,
				version: context.version ?? CURRENT_SCHEMA_VERSION,
				metadata: context.metadata ?? { createdAt: new Date().toISOString() },
			};
			this.#atomicWrite(filePath, JSON.stringify(payload, null, 2));
			imported.push(context.name);
			if (wasExisting) overwritten.push(context.name);
		}

		// 7. Cache refresh
		await this.listContexts();

		// 8. Refresh active-context state if its backing file was overwritten.
		// importContexts's write loop replaces the on-disk JSON, but #activeContext,
		// Settings.bash.environment (apiUrl/apiToken/namespace), and the cached
		// auth metadata all hold a snapshot from the prior activate() call. Without
		// this step, a successful `/context import --overwrite` that touches the
		// active context leaves the session talking to the wrong tenant with the
		// wrong token until the user restarts or re-activates manually.
		const activeName = this.#activeContext?.name;
		if (activeName && overwritten.includes(activeName)) {
			await this.activate(activeName);
		}

		return { imported, overwritten, skipped: [] };
	}

	/**
	 * Rename a context. File is renamed first (atomic rename(2)); if the context
	 * is active, active_context is then updated to point at the new name. If the
	 * pointer update fails, the file rename is rolled back.
	 *
	 * Throws ContextError for invalid names, missing source, or a target name
	 * that already exists. If the pointer-write rollback itself fails, logs a
	 * warning and throws a ContextError documenting the inconsistent filesystem
	 * state for manual recovery.
	 *
	 * Fires onContextChange listeners when the active context is renamed.
	 *
	 * Note: does not rewrite the JSON body's "name" field. #readContext treats
	 * the filename as canonical identity, so the stale field is inert.
	 */
	async renameContext(oldName: string, newName: string): Promise<void> {
		this.#validateContextName(oldName);
		this.#validateContextName(newName);
		this.#assertNotReserved(newName);

		const oldPath = path.join(this.contextsDir, `${oldName}.json`);
		const newPath = path.join(this.contextsDir, `${newName}.json`);

		// Existence check fires BEFORE the identity short-circuit so
		// `renameContext("ghost", "ghost")` returns the expected not-found error
		// instead of a silent success that hides a typo.
		if (!fs.existsSync(oldPath)) {
			throw new ContextError(`Context '${oldName}' not found.`, oldName);
		}
		if (oldName === newName) return;
		if (fs.existsSync(newPath)) {
			throw new ContextError(`Context '${newName}' already exists.`, newName);
		}

		// Step 1: rename file (atomic rename(2) on the same filesystem)
		fs.renameSync(oldPath, newPath);

		// Step 2: if renaming the active context, update the pointer. On failure
		// we must roll back the file rename so the user sees a consistent state.
		// Consult BOTH the hydrated in-memory state AND the on-disk pointer:
		// loadActive() leaves #activeContext null when F5XC_API_URL overrides
		// the context, but the on-disk active_context file may still name the
		// context being renamed — and the next non-env session relies on that
		// pointer to restore the user's active selection.
		const onDiskActiveName = this.#readActiveContextName();
		const wasActive = this.#activeContext?.name === oldName || onDiskActiveName === oldName;
		if (wasActive) {
			try {
				this.#atomicWrite(this.activeContextPath, newName);
			} catch (err) {
				// Rollback. Inner try wraps ONLY the rename-back call so the
				// rollback-succeeded / rollback-failed paths are clearly separated.
				try {
					fs.renameSync(newPath, oldPath);
				} catch (rollbackErr) {
					logger.warn("F5XC context rename rollback failed — manual recovery required", {
						oldName,
						newName,
						originalError: String(err),
						rollbackError: String(rollbackErr),
					});
					throw new ContextError(
						`Rename failed and rollback failed. Filesystem state: contexts/${newName}.json exists, active_context still points at '${oldName}'. Manually rename contexts/${newName}.json back to contexts/${oldName}.json, or update active_context to '${newName}'. Original error: ${err instanceof Error ? err.message : String(err)}. Rollback error: ${String(rollbackErr)}`,
						oldName,
					);
				}
				// Rollback succeeded — throw the user-friendly error.
				throw new ContextError(
					`Failed to update active context pointer: ${err instanceof Error ? err.message : String(err)}. Context was not renamed.`,
					oldName,
				);
			}
		}

		// Step 3: update cache + active-context pointer in memory.
		// Private-static listener access uses the same idiom as #applyToSettings
		// (the loop `for (const cb of ContextService.#onContextChangeListeners)`
		// already appears in that method) — direct `ContextService.#name` access
		// from inside the class body.
		this.#contextsCache = this.#contextsCache
			.map(p => (p.name === oldName ? { ...p, name: newName } : p))
			.sort((a, b) => a.name.localeCompare(b.name));
		if (this.#previousContextName === oldName) {
			this.#previousContextName = newName;
		}
		if (wasActive && this.#activeContext) {
			this.#activeContext = { ...this.#activeContext, name: newName };
			for (const cb of ContextService.#onContextChangeListeners) {
				cb(this.#activeContext);
			}
		}
	}

	/** Add or update environment variables on a context. Keys matching secret
	 *  naming patterns are automatically added to sensitiveKeys. */
	async setEnvVars(name: string, vars: Record<string, string>): Promise<{ sensitive: string[] }> {
		this.#validateContextName(name);
		const context = this.#readContext(name);
		if (!context) throw new ContextError(`Context '${name}' not found.`, name);

		this.#assertCompatibleVersion(context);

		const reservedViolations = Object.keys(vars).filter(k => RESERVED_ENV_KEYS.has(k));
		if (reservedViolations.length > 0) {
			const messages = reservedViolations.map(k => RESERVED_ENV_MESSAGES[k]).join("\n");
			throw new ContextError(messages, name);
		}

		const env = { ...(context.env ?? {}), ...vars };
		const sensitiveSet = new Set(context.sensitiveKeys ?? []);
		const newSensitive: string[] = [];
		for (const key of Object.keys(vars)) {
			if (SECRET_ENV_PATTERNS.test(key) && !sensitiveSet.has(key)) {
				sensitiveSet.add(key);
				newSensitive.push(key);
			}
		}
		// Remove sensitiveKeys entries for keys no longer in env
		const sensitiveKeys = [...sensitiveSet].filter(k => k in env);

		const updated: F5XCContext = {
			...context,
			env,
			sensitiveKeys: sensitiveKeys.length > 0 ? sensitiveKeys : undefined,
		};
		const contextPath = path.join(this.contextsDir, `${name}.json`);
		this.#atomicWrite(contextPath, JSON.stringify(updated, null, 2));
		this.#contextsCache = this.#contextsCache.map(p => (p.name === name ? updated : p));

		if (this.#activeContext?.name === name) {
			this.#activeContext = updated;
			this.#applyToSettings(updated);
		}
		return { sensitive: newSensitive };
	}

	/** Remove environment variables from a context. Also removes them from sensitiveKeys. */
	async unsetEnvVars(name: string, keys: string[]): Promise<{ removed: string[] }> {
		this.#validateContextName(name);
		const context = this.#readContext(name);
		if (!context) throw new ContextError(`Context '${name}' not found.`, name);

		this.#assertCompatibleVersion(context);

		const env = { ...(context.env ?? {}) };
		const removed: string[] = [];
		for (const key of keys) {
			if (key in env) {
				delete env[key];
				removed.push(key);
			}
		}
		if (removed.length === 0) return { removed: [] };

		const keySet = new Set(keys);
		const sensitiveKeys = (context.sensitiveKeys ?? []).filter(k => !keySet.has(k) && k in env);
		const envOrUndefined = Object.keys(env).length > 0 ? env : undefined;

		const updated: F5XCContext = {
			...context,
			env: envOrUndefined,
			sensitiveKeys: sensitiveKeys.length > 0 ? sensitiveKeys : undefined,
		};
		const contextPath = path.join(this.contextsDir, `${name}.json`);
		this.#atomicWrite(contextPath, JSON.stringify(updated, null, 2));
		this.#contextsCache = this.#contextsCache.map(p => (p.name === name ? updated : p));

		if (this.#activeContext?.name === name) {
			this.#activeContext = updated;
			this.#applyToSettings(updated);
		}
		return { removed };
	}

	async validateToken(options?: {
		timeoutMs?: number;
		apiUrl?: string;
		apiToken?: string;
	}): Promise<{ status: AuthStatus; latencyMs?: number; errorClass?: "network" | "credential" | "url_not_found" }> {
		// Use explicit credentials if provided (for non-active contexts or env-backed sessions),
		// otherwise fall back to effective credentials (env override > active context)
		const effectiveUrl = options?.apiUrl ?? process.env[F5XC_API_URL] ?? this.#activeContext?.apiUrl;
		const effectiveToken = options?.apiToken ?? process.env[F5XC_API_TOKEN] ?? this.#activeContext?.apiToken;
		if (!effectiveUrl || !effectiveToken) return { status: "unknown" };

		// Ad-hoc mode: caller is validating credentials that DIFFER from the active/effective
		// ones — e.g., `/context show <other>` passes a non-active context's apiUrl/apiToken.
		// In that case, do NOT touch the cached auth state — getStatus() would otherwise report
		// the active context's identity with some other context's latency/status.
		//
		// `/context show` on the ACTIVE context (and `/context show` with no name, which resolves
		// to the active name) also passes explicit creds via handleShow, but those creds match
		// the active/effective ones, so we DO want to refresh the cache — a user running
		// /context show on the active context is explicitly requesting a fresh validation.
		const activeUrl = process.env[F5XC_API_URL] ?? this.#activeContext?.apiUrl;
		const activeToken = process.env[F5XC_API_TOKEN] ?? this.#activeContext?.apiToken;
		const adHoc =
			(options?.apiUrl !== undefined && options.apiUrl !== activeUrl) ||
			(options?.apiToken !== undefined && options.apiToken !== activeToken);

		const url = `${effectiveUrl}/api/web/namespaces`;
		const timeout = options?.timeoutMs ?? 3000;
		const checkedAt = Date.now();
		try {
			const start = performance.now();
			const response = await fetch(url, {
				method: "GET",
				headers: { Authorization: `APIToken ${effectiveToken}`, Accept: "application/json" },
				signal: AbortSignal.timeout(timeout),
				redirect: "manual",
			});
			const latencyMs = Math.round(performance.now() - start);
			if (!adHoc) {
				this.#lastAuthLatencyMs = latencyMs;
				this.#lastAuthCheckedAt = checkedAt;
			}
			if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
				if (!adHoc) this.#authStatus = "offline";
				return { status: "offline", latencyMs, errorClass: "url_not_found" };
			}
			if (response.ok) {
				const contentType = response.headers.get("content-type") ?? "";
				if (!contentType.includes("application/json")) {
					if (!adHoc) this.#authStatus = "offline";
					return { status: "offline", latencyMs, errorClass: "url_not_found" };
				}
				if (!adHoc) this.#authStatus = "connected";
				return { status: "connected", latencyMs };
			}
			if (response.status === 401 || response.status === 403) {
				if (!adHoc) this.#authStatus = "auth_error";
				return { status: "auth_error", latencyMs, errorClass: "credential" };
			}
			// 5xx, 429, etc. — server reachable but unhealthy; treat as offline so startup retry fires
			if (!adHoc) this.#authStatus = "offline";
			return { status: "offline", latencyMs, errorClass: "network" };
		} catch {
			if (!adHoc) {
				this.#lastAuthLatencyMs = Date.now() - checkedAt;
				this.#lastAuthCheckedAt = checkedAt;
				this.#authStatus = "offline";
			}
			return { status: "offline", errorClass: "network" };
		}
	}

	/**
	 * Validate credentials for a named context without switching the active one.
	 * Uses validateToken's ad-hoc branch (explicit apiUrl + apiToken), so no
	 * cached auth state, namespace cache, or active context is mutated.
	 *
	 * Throws ContextError when the name is invalid, the context is missing, or
	 * the context's schema version is incompatible. Auth failure is not thrown:
	 * it is returned as ValidationResult.status = "auth_error" / "offline".
	 */
	async validateContextByName(name: string): Promise<ValidationResult> {
		this.#validateContextName(name);
		const context = this.#readContext(name);
		if (!context) {
			throw new ContextError(`Context '${name}' not found.`, name);
		}
		this.#assertCompatibleVersion(context);
		const { status, latencyMs, errorClass } = await this.validateToken({
			apiUrl: context.apiUrl,
			apiToken: context.apiToken,
		});
		return { context, status, latencyMs, errorClass };
	}

	setNamespace(namespace: string): void {
		if (!this.#activeContext) {
			throw new ContextError("No active context. Run `/context activate <name>` to select one.");
		}
		this.#activeContext = { ...this.#activeContext, defaultNamespace: namespace };
		// Re-apply settings with the new namespace
		this.#applyToSettings(this.#activeContext);
		this.#credentialSource = hasEnvOverride() ? "mixed" : "context";
	}

	getStatus(): ContextStatus {
		const url = process.env[F5XC_API_URL] ?? this.#activeContext?.apiUrl ?? null;
		const tenant = url ? deriveTenantFromUrl(url) : null;
		return {
			activeContextName: this.#activeContext?.name ?? null,
			activeContextUrl: url,
			activeContextTenant: tenant,
			activeContextNamespace: process.env[F5XC_NAMESPACE] ?? this.#activeContext?.defaultNamespace ?? null,
			credentialSource: this.#credentialSource,
			authStatus: this.#authStatus,
			isConfigured: this.#credentialSource !== "none",
			authLatencyMs: this.#lastAuthLatencyMs,
			authCheckedAt: this.#lastAuthCheckedAt,
			tokenHealth: this.#computeTokenHealth(),
		};
	}

	/** Sync list of env var keys on the active context, sorted. [] if no active context. */
	getActiveEnvKeys(): string[] {
		return Object.keys(this.#activeContext?.env ?? {}).sort();
	}

	/** Sync set of sensitive env var keys on the active context. Empty set if none. */
	getActiveSensitiveKeys(): ReadonlySet<string> {
		return new Set(this.#activeContext?.sensitiveKeys ?? []);
	}

	/** Sync list of known context names, sorted. [] before the first listContexts()/loadActive(). */
	listContextNamesCached(): string[] {
		return this.#contextsCache.map(p => p.name);
	}

	/**
	 * Sync hint for a context name. Used by the `/context activate` completion
	 * to display the tenant URL and a schema-incompatibility badge.
	 * Returns null if the name is not in the cache.
	 * `incompatible` is always set; `schemaVersion` is set only when incompatible.
	 */
	getContextHint(name: string): { apiUrl?: string; incompatible: boolean; schemaVersion?: number } | null {
		const context = this.#contextsCache.find(p => p.name === name);
		if (!context) return null;
		const version = context.version;
		const incompatible = version !== undefined && version > CURRENT_SCHEMA_VERSION;
		return {
			apiUrl: context.apiUrl,
			incompatible,
			...(incompatible ? { schemaVersion: version } : {}),
		};
	}

	/** Sync namespace names from the most recent successful validateToken response, sorted. */
	getCachedNamespaces(): string[] {
		return [...this.#namespacesCache];
	}

	getActiveContextSkillConfig(): { skillDirs: string[]; includeSkills: string[]; excludeSkills: string[] } {
		const ctx = this.#activeContext;
		return {
			skillDirs: ctx?.knowledgeSources?.filter(s => s.type === "skill-dir").map(s => s.url) ?? [],
			includeSkills: ctx?.includeSkills ?? [],
			excludeSkills: ctx?.excludeSkills ?? [],
		};
	}

	maskToken(token: string): string {
		if (token.length <= 4) return "****";
		return `...${token.slice(-4)}`;
	}

	// --- Private helpers ---

	#atomicWrite(filePath: string, content: string): void {
		const tmpPath = `${filePath}.tmp`;
		// Force 0o600 on the tmp file so the atomic rename produces a
		// destination with credential-file permissions. Without this, the
		// tmp inherits process umask (typically 0644), fs.renameSync carries
		// those permissions onto the destination, and any context JSON
		// updated through this helper (setEnvVars, unsetEnvVars, import
		// overwrite) ends up world-readable even though createContext
		// explicitly writes at 0o600. active_context pointer is also
		// tightened — it names the context but carries no credentials, so
		// 0o600 is strictly no worse.
		fs.writeFileSync(tmpPath, content, { mode: 0o600 });
		fs.renameSync(tmpPath, filePath);
	}

	#isValidContextName(name: string): boolean {
		return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
	}

	#validateContextName(name: string): void {
		if (!this.#isValidContextName(name)) {
			throw new ContextError(
				`Invalid context name: '${name}'. Names must be alphanumeric with dashes/underscores, max 64 chars.`,
				name,
			);
		}
	}

	#assertNotReserved(name: string): void {
		if (RESERVED_CONTEXT_NAMES.has(name.toLowerCase())) {
			throw new ContextError(
				`Context name '${name}' conflicts with a /context subcommand. Choose a different name.`,
				name,
			);
		}
	}

	#assertCompatibleVersion(context: F5XCContext): void {
		if (context.version !== undefined && context.version > CURRENT_SCHEMA_VERSION) {
			throw new ContextError(
				`Context '${context.name}' uses schema version ${context.version}, but this version of xcsh only supports version ${CURRENT_SCHEMA_VERSION}. Upgrade xcsh to use this context, or run \`/context create\` to create a new one.`,
				context.name,
			);
		}
	}

	#readActiveContextName(): string | null {
		try {
			if (!fs.existsSync(this.activeContextPath)) return null;
			const name = fs.readFileSync(this.activeContextPath, "utf-8").trim();
			if (!name) return null;
			// Validate to prevent path traversal from crafted active_context files
			if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
				logger.warn("F5XC active_context contains invalid name", { name });
				return null;
			}
			return name;
		} catch {
			return null;
		}
	}

	/**
	 * Field-shape check for a parsed context object. Returns a normalized
	 * F5XCContext when obj passes the same rules #readContext enforces on disk
	 * reads, or null when a required field is missing/wrong-typed.
	 *
	 * Used by #readContext (canonical name = filename) and by importContexts
	 * (canonical name = obj.name, which the caller must already have validated
	 * via #isValidContextName).
	 *
	 * Side effect: logger.warn on failure, matching #readContext's original
	 * behavior so existing log-assertion tests continue to pass.
	 */
	#validateContextShape(obj: unknown, canonicalName: string): F5XCContext | null {
		if (!obj || typeof obj !== "object") {
			logger.warn("F5XC context is not an object", { name: canonicalName });
			return null;
		}
		const parsed = obj as Record<string, unknown>;

		if (
			!parsed.apiUrl ||
			typeof parsed.apiUrl !== "string" ||
			!parsed.apiToken ||
			typeof parsed.apiToken !== "string"
		) {
			logger.warn("F5XC context missing or invalid required fields", { name: canonicalName });
			return null;
		}
		if (parsed.defaultNamespace && typeof parsed.defaultNamespace !== "string") {
			logger.warn("F5XC context has non-string defaultNamespace", { name: canonicalName });
			return null;
		}

		let env: Record<string, string> | undefined;
		if (parsed.env && typeof parsed.env === "object" && !Array.isArray(parsed.env)) {
			env = {};
			for (const [k, v] of Object.entries(parsed.env)) {
				if (typeof v !== "string") continue;
				if (RESERVED_ENV_KEYS.has(k)) {
					// Resolve the corresponding top-level field to detect value mismatches
					let topLevelValue: string | undefined;
					switch (k) {
						case F5XC_NAMESPACE:
							topLevelValue = typeof parsed.defaultNamespace === "string" ? parsed.defaultNamespace : undefined;
							break;
						case F5XC_API_URL:
							topLevelValue = typeof parsed.apiUrl === "string" ? parsed.apiUrl : undefined;
							break;
						case F5XC_API_TOKEN:
							topLevelValue = typeof parsed.apiToken === "string" ? parsed.apiToken : undefined;
							break;
						default:
							topLevelValue = undefined;
							break; // F5XC_TENANT: derived, no stored top-level field
					}
					// Warn on mismatch OR when there is no top-level field to compare (F5XC_TENANT)
					if (topLevelValue === undefined || v !== topLevelValue) {
						logger.warn("F5XC context env contains reserved key — stripping", {
							name: canonicalName,
							key: k,
							envValue: SECRET_ENV_PATTERNS.test(k) ? "[redacted]" : v,
							topLevelValue: SECRET_ENV_PATTERNS.test(k) ? "[redacted]" : (topLevelValue ?? "(derived)"),
						});
					}
					continue;
				}
				env[k] = v;
			}
			if (Object.keys(env).length === 0) env = undefined;
		}

		let sensitiveKeys: string[] | undefined;
		if (Array.isArray(parsed.sensitiveKeys) && env) {
			const filtered = parsed.sensitiveKeys.filter((k: unknown): k is string => typeof k === "string" && k in env);
			sensitiveKeys = filtered.length > 0 ? filtered : undefined;
		}

		let knowledgeSources: KnowledgeSource[] | undefined;
		if (Array.isArray(parsed.knowledgeSources)) {
			const validTypes = new Set(["llms-txt", "skill-dir", "docs-site"]);
			const filtered = (parsed.knowledgeSources as unknown[]).filter((s): s is KnowledgeSource => {
				if (!s || typeof s !== "object") return false;
				const entry = s as Record<string, unknown>;
				if (typeof entry.url !== "string") return false;
				if ("type" in entry && !validTypes.has(entry.type as string)) return false;
				return true;
			});
			knowledgeSources = filtered.length > 0 ? filtered : undefined;
		}

		let includeSkills: string[] | undefined;
		if (Array.isArray(parsed.includeSkills)) {
			const filtered = (parsed.includeSkills as unknown[]).filter((s): s is string => typeof s === "string");
			includeSkills = filtered.length > 0 ? filtered : undefined;
		}

		let excludeSkills: string[] | undefined;
		if (Array.isArray(parsed.excludeSkills)) {
			const filtered = (parsed.excludeSkills as unknown[]).filter((s): s is string => typeof s === "string");
			excludeSkills = filtered.length > 0 ? filtered : undefined;
		}

		return {
			name: canonicalName,
			apiUrl: parsed.apiUrl,
			apiToken: parsed.apiToken,
			defaultNamespace: typeof parsed.defaultNamespace === "string" ? parsed.defaultNamespace : "default",
			env,
			sensitiveKeys,
			knowledgeSources,
			includeSkills,
			excludeSkills,
			version: typeof parsed.version === "number" ? parsed.version : undefined,
			metadata:
				parsed.metadata && typeof parsed.metadata === "object" && !Array.isArray(parsed.metadata)
					? (parsed.metadata as F5XCContext["metadata"])
					: undefined,
		};
	}

	#readContext(name: string): F5XCContext | null {
		const filePath = path.join(this.contextsDir, `${name}.json`);
		try {
			if (!fs.existsSync(filePath)) {
				logger.warn("F5XC context file not found", { name, path: filePath });
				return null;
			}
			const content = fs.readFileSync(filePath, "utf-8");
			const parsed = JSON.parse(content);
			return this.#validateContextShape(parsed, name);
		} catch (err) {
			logger.warn("F5XC context read error", { name, error: String(err) });
			return null;
		}
	}

	#listContextFiles(): string[] {
		try {
			if (!fs.existsSync(this.contextsDir)) return [];
			return fs.readdirSync(this.contextsDir).filter(f => f.endsWith(".json"));
		} catch {
			return [];
		}
	}

	#applyToSettings(context: F5XCContext): void {
		// Per-field merge: skip any key already in process.env (subprocess inherits
		// it directly), inject context values for the rest. This avoids both
		// overriding explicit env vars AND losing context values for unset keys.
		const existing = (Settings.instance.get("bash.environment") ?? {}) as Record<string, string>;
		// Preserve non-F5XC keys (user-defined HTTP_PROXY, PATH, etc.) but clear
		// all F5XC_* keys to prevent stale credentials leaking across context switches
		const merged: Record<string, string> = {};
		for (const [key, value] of Object.entries(existing)) {
			if (!key.startsWith("F5XC_")) merged[key] = value;
		}
		if (!process.env[F5XC_API_URL]) merged[F5XC_API_URL] = context.apiUrl;
		if (!process.env[F5XC_API_TOKEN]) merged[F5XC_API_TOKEN] = context.apiToken;
		if (!process.env[F5XC_NAMESPACE]) merged[F5XC_NAMESPACE] = context.defaultNamespace;

		// Auto-derive F5XC_TENANT from first hostname label of apiUrl
		if (!process.env[F5XC_TENANT]) {
			const tenant = deriveTenantFromUrl(context.apiUrl);
			if (tenant) merged[F5XC_TENANT] = tenant;
		}

		// Inject all additional env vars from context.env map
		if (context.env) {
			for (const [key, value] of Object.entries(context.env)) {
				if (!process.env[key] && !(RESERVED_ENV_KEYS.has(key) && key in merged)) merged[key] = value;
			}
		}

		Settings.instance.override("bash.environment", merged);
		Settings.instance.override("f5xc.sensitiveKeys", context.sensitiveKeys ?? []);

		// Notify listeners (e.g. obfuscator refresh) about the context change.
		for (const cb of ContextService.#onContextChangeListeners) {
			cb(context);
		}
	}
}
