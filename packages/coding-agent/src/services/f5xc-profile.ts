import * as fs from "node:fs";
import * as path from "node:path";
import { getF5XCConfigDir, logger } from "@f5xc-salesdemos/pi-utils";
import { Settings } from "../config/settings";
import { SECRET_ENV_PATTERNS } from "../secrets/index";
import {
	deriveTenantFromUrl,
	F5XC_API_TOKEN,
	F5XC_API_URL,
	F5XC_NAMESPACE,
	F5XC_TENANT,
	hasEnvOverride,
} from "./f5xc-env";

export const CURRENT_SCHEMA_VERSION = 1;

export const CURRENT_EXPORT_VERSION = 1;

export interface ExportBundle {
	/** Export format version — distinct from per-profile F5XCProfile.version (schema version). */
	version: number;
	exportedAt: string;
	/** When true, importProfiles rejects this bundle. */
	tokensMasked: boolean;
	/** Same shape as on-disk profile JSON. Tokens masked iff tokensMasked=true. */
	profiles: F5XCProfile[];
}

export interface ImportResult {
	imported: string[];
	overwritten: string[];
	skipped: string[];
}

export interface F5XCProfile {
	name: string;
	apiUrl: string;
	apiToken: string;
	defaultNamespace: string;
	env?: Record<string, string>;
	/** Env var names from `env` whose values should be masked in output (e.g. ["F5XC_USERNAME"]). */
	sensitiveKeys?: string[];
	version?: number;
	metadata?: {
		createdAt?: string;
		expiresAt?: string;
		lastRotatedAt?: string;
		rotateAfterDays?: number;
	};
}

export type AuthStatus = "connected" | "auth_error" | "offline" | "unknown";

export interface ProfileStatus {
	activeProfileName: string | null;
	activeProfileUrl: string | null;
	activeProfileTenant: string | null;
	activeProfileNamespace: string | null;
	credentialSource: "profile" | "environment" | "mixed" | "none";
	authStatus: AuthStatus;
	isConfigured: boolean;
	/** Milliseconds measured by the most recent validateToken() call. Absent if validateToken has not run. */
	authLatencyMs?: number;
	/** Epoch ms of the most recent validateToken() call. Absent if validateToken has not run. */
	authCheckedAt?: number;
}

/**
 * Result of validating credentials for a named profile without activating it.
 * Returned by `ProfileService.validateProfileByName()`. Callers get the full
 * profile back rather than correlating by name so rendering code can use a
 * single object (tenant, URL, masked token, status) without a second lookup.
 *
 * Auth failure is carried here as `status: "auth_error" | "offline"` with
 * optional `errorClass` — not thrown. The method throws only for missing /
 * invalid-name / incompatible-version cases.
 */
export interface ValidationResult {
	profile: F5XCProfile;
	status: AuthStatus;
	latencyMs?: number;
	errorClass?: "network" | "credential";
}

export class ProfileError extends Error {
	constructor(
		message: string,
		readonly profileName?: string,
	) {
		super(message);
		this.name = "ProfileError";
	}
}

export class ProfileService {
	static #instance: ProfileService | null = null;
	static #onProfileChangeListeners: Array<(profile: F5XCProfile) => void> = [];

	/** Register a callback invoked after a profile is activated or its settings applied. */
	static onProfileChange(cb: (profile: F5XCProfile) => void): void {
		ProfileService.#onProfileChangeListeners.push(cb);
	}

	/**
	 * Remove a previously-registered profile-change callback. No-op if the callback isn't registered.
	 * Call on session disposal to prevent leaked listeners from mutating dead session state.
	 */
	static offProfileChange(cb: (profile: F5XCProfile) => void): void {
		const idx = ProfileService.#onProfileChangeListeners.indexOf(cb);
		if (idx >= 0) ProfileService.#onProfileChangeListeners.splice(idx, 1);
	}

	#configDir: string;
	#activeProfile: F5XCProfile | null = null;
	#credentialSource: ProfileStatus["credentialSource"] = "none";
	#authStatus: AuthStatus = "unknown";
	#profilesCache: F5XCProfile[] = [];
	#namespacesCache: string[] = [];
	/** Incremented on every `activate()`. Fire-and-forget namespace body-parses snapshot
	 * this at fetch time and discard the result if it has advanced — prevents a stale
	 * in-flight response from overwriting the cache after the active profile changed. */
	#activationEpoch = 0;
	#lastAuthLatencyMs: number | undefined;
	#lastAuthCheckedAt: number | undefined;

	private constructor(configDir: string) {
		this.#configDir = configDir;
	}

	static init(configDir: string): ProfileService {
		ProfileService.#instance = new ProfileService(configDir);
		return ProfileService.#instance;
	}

	/**
	 * Return the existing instance, or bootstrap one using the provided
	 * configDir (or `getF5XCConfigDir()` if omitted) and run loadActive()
	 * before returning.
	 *
	 * Primary patterns used in-tree:
	 *   - main.ts: CLI startup calls `ProfileService.init(dir).loadActive()`
	 *     eagerly — deterministic, synchronous path for the CLI.
	 *   - SDK/embedder paths and slash-command handlers call
	 *     `ProfileService.getOrInit()` — returns existing or bootstraps.
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
	static async getOrInit(configDir?: string): Promise<ProfileService> {
		if (ProfileService.#instance) return ProfileService.#instance;
		const dir = configDir ?? getF5XCConfigDir();
		const service = ProfileService.init(dir);
		await service.loadActive();
		return service;
	}

	/**
	 * Return the values of env vars marked as sensitive in the active profile.
	 * Safe to call before init — returns empty array if no profile is loaded.
	 */
	static getSensitiveProfileValues(): string[] {
		const instance = ProfileService.#instance;
		if (!instance) return [];
		const profile = instance.#activeProfile;
		if (!profile?.sensitiveKeys?.length || !profile.env) return [];
		const values: string[] = [];
		for (const key of profile.sensitiveKeys) {
			const value = profile.env[key];
			if (value) values.push(value);
		}
		return values;
	}

	static get instance(): ProfileService {
		if (!ProfileService.#instance) {
			throw new Error("ProfileService not initialized. Call ProfileService.init() first.");
		}
		return ProfileService.#instance;
	}

	static _resetForTest(): void {
		ProfileService.#instance = null;
		// Clear listeners to prevent cross-test contamination. Each createAgentSession() call
		// registers a listener closed over that session's sessionManager; without this reset,
		// listeners from a disposed session persist into the next test and fire on activate().
		ProfileService.#onProfileChangeListeners = [];
	}

	get profilesDir(): string {
		return path.join(this.#configDir, "profiles");
	}

	get activeProfilePath(): string {
		return path.join(this.#configDir, "active_profile");
	}

	async loadActive(): Promise<F5XCProfile | null> {
		// FR-102: F5XC_API_URL is the signal to skip profile loading entirely.
		// Subprocesses inherit process.env, so they already see the env vars directly.
		if (process.env[F5XC_API_URL]) {
			this.#credentialSource = "environment";
			return null;
		}

		// Check if config dir exists
		if (!fs.existsSync(this.#configDir)) {
			return null;
		}

		// Seed the profile cache so `/profile activate <tab>` has data at startup.
		// listProfiles is declared async but its body uses fs.readdirSync /
		// readFileSync — the cost is proportional to the number of profile files.
		// For typical N ≤ 10 on local disk this is sub-millisecond; profiles are
		// small JSON files. A future refactor to fs.promises + truly async I/O
		// would let startup proceed in parallel with the reads, but the current
		// sync form keeps createProfile/deleteProfile race-free with no coordination.
		await this.listProfiles();

		let profileName = this.#readActiveProfileName();

		// FR-104: auto-activate if exactly one profile exists
		let autoActivated = false;
		if (!profileName) {
			const profiles = this.#listProfileFiles();
			if (profiles.length === 1) {
				profileName = profiles[0].replace(/\.json$/, "");
				autoActivated = true;
			} else {
				return null;
			}
		}

		// Read the profile JSON
		const profile = this.#readProfile(profileName);
		if (!profile) {
			return null;
		}

		// Gate: incompatible schema version — log warning and return null (don't crash startup)
		try {
			this.#assertCompatibleVersion(profile);
		} catch (err) {
			logger.warn("F5XC: profile uses incompatible schema version, skipping", {
				name: profileName,
				error: String(err),
			});
			return null;
		}

		// Only persist active_profile after the profile validates
		if (autoActivated) {
			this.#atomicWrite(this.activeProfilePath, profileName);
			logger.debug("F5XC: auto-activated single profile", { name: profileName });
		}

		this.#activeProfile = profile;
		this.#applyToSettings(profile);
		// Detect mixed source: profile loaded but some fields come from process.env
		this.#credentialSource = hasEnvOverride() ? "mixed" : "profile";
		return profile;
	}

	async activate(name: string): Promise<F5XCProfile> {
		// Reject activation when env overrides are present — before any I/O
		if (process.env[F5XC_API_URL]) {
			throw new ProfileError(
				"Cannot activate: F5XC_API_URL environment variable overrides profile. Run `unset F5XC_API_URL` first, or restart without it.",
			);
		}

		// Self-heal: activate called before loadActive ever ran. Populate cache.
		if (this.#profilesCache.length === 0) {
			await this.listProfiles();
		}

		this.#validateProfileName(name);
		const profile = this.#readProfile(name);
		if (!profile) {
			throw new ProfileError(`Profile '${name}' not found. Run \`/profile list\` to see available profiles.`, name);
		}

		this.#assertCompatibleVersion(profile);

		// NFR-402: write active_profile first — if it fails, don't update settings
		this.#atomicWrite(this.activeProfilePath, name);

		this.#activeProfile = profile;
		this.#applyToSettings(profile);
		this.#credentialSource = hasEnvOverride() ? "mixed" : "profile";
		this.#namespacesCache = [];
		this.#activationEpoch += 1;

		// Invalidate auth-freshness cache on profile switch — the previous profile's latency
		// and "checked N min ago" timestamp are stale now that a different tenant is active.
		// Subsequent validateToken() (e.g., from /profile status) repopulates these fields.
		this.#authStatus = "unknown";
		this.#lastAuthLatencyMs = undefined;
		this.#lastAuthCheckedAt = undefined;

		return profile;
	}

	async listProfiles(): Promise<F5XCProfile[]> {
		const files = this.#listProfileFiles();
		const profiles: F5XCProfile[] = [];
		for (const file of files) {
			const name = file.replace(/\.json$/, "");
			// Skip files whose basename doesn't satisfy the profile-name contract —
			// they cannot be activated (#validateProfileName would reject), so
			// surfacing them in /profile list or /profile activate <tab> just
			// offers users a selection that the handler will immediately refuse.
			if (!this.#isValidProfileName(name)) {
				logger.warn("F5XC profile file has invalid name, skipping", { name });
				continue;
			}
			const profile = this.#readProfile(name);
			if (profile) {
				profiles.push(profile);
			}
		}
		this.#profilesCache = [...profiles].sort((a, b) => a.name.localeCompare(b.name));
		return [...this.#profilesCache];
	}

	async createProfile(profile: Omit<F5XCProfile, "metadata" | "version">): Promise<void> {
		this.#validateProfileName(profile.name);
		const profilePath = path.join(this.profilesDir, `${profile.name}.json`);
		if (fs.existsSync(profilePath)) {
			throw new ProfileError(`Profile '${profile.name}' already exists.`, profile.name);
		}
		fs.mkdirSync(this.profilesDir, { recursive: true, mode: 0o700 });
		fs.mkdirSync(this.#configDir, { recursive: true, mode: 0o700 });
		const data: F5XCProfile = {
			...profile,
			version: CURRENT_SCHEMA_VERSION,
			metadata: { createdAt: new Date().toISOString() },
		};
		const tmpPath = `${profilePath}.tmp`;
		fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
		fs.renameSync(tmpPath, profilePath);
		this.#profilesCache = [...this.#profilesCache, data].sort((a, b) => a.name.localeCompare(b.name));
	}

	async deleteProfile(name: string): Promise<void> {
		this.#validateProfileName(name);
		const profilePath = path.join(this.profilesDir, `${name}.json`);
		if (!fs.existsSync(profilePath)) {
			throw new ProfileError(`Profile '${name}' not found.`, name);
		}
		fs.unlinkSync(profilePath);
		this.#profilesCache = this.#profilesCache.filter(p => p.name !== name);
	}

	/**
	 * Export one or more profiles as an ExportBundle. Profiles are deep-cloned
	 * before any masking to guarantee the in-memory cache (#profilesCache and
	 * #activeProfile, which may share references) is never mutated.
	 *
	 * When includeToken is false, apiToken and every env value whose key is in
	 * sensitiveKeys is replaced with the masked form. The envelope's
	 * tokensMasked flag reflects this so importProfiles can refuse masked
	 * bundles.
	 *
	 * Throws ProfileError when a requested name does not exist on disk.
	 */
	async exportProfiles(opts: { names?: string[]; includeToken: boolean }): Promise<ExportBundle> {
		const all = await this.listProfiles();
		let selected: F5XCProfile[];
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
				throw new ProfileError(`Profile(s) not found: ${missing.join(", ")}.`, missing[0]);
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
					// from the pattern, but profiles edited directly on disk or
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
			profiles: cloned,
		};
	}

	/**
	 * Import profiles from a bundle. Validation order is load-bearing:
	 *   1. Envelope schema (object with version/tokensMasked/profiles).
	 *   2. Version match.
	 *   3. tokensMasked: true is rejected — masked tokens would pass write but
	 *      fail runtime auth with a misleading error.
	 *   4. Per-profile field-shape via #validateProfileShape — any failure
	 *      rejects the whole import; no writes occur.
	 *   5. Conflict detection against a fresh listProfiles() read — not the
	 *      in-memory cache, which can miss concurrent-session edits.
	 *   6. Atomic per-file write loop. Each write is atomic individually via
	 *      #atomicWrite, but the overall import is NOT transactional: if the
	 *      Nth of M writes throws, the first N-1 profiles are kept and the
	 *      remainder are not written. Multi-file rollback would require a
	 *      two-phase commit we do not implement; validation steps 1–5 catch
	 *      all foreseeable failures before any write begins.
	 *   7. Cache refresh.
	 */
	async importProfiles(bundle: unknown, opts: { overwrite: boolean }): Promise<ImportResult> {
		// 1. Envelope schema
		if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
			throw new ProfileError("Import bundle missing required fields: bundle must be an object.");
		}
		const b = bundle as Record<string, unknown>;
		if (typeof b.version !== "number" || typeof b.tokensMasked !== "boolean" || !Array.isArray(b.profiles)) {
			throw new ProfileError(
				"Import bundle missing required fields: expected { version: number, tokensMasked: boolean, profiles: array }.",
			);
		}

		// 2. Version
		if (b.version !== CURRENT_EXPORT_VERSION) {
			throw new ProfileError(
				`Import bundle uses export version ${b.version}, but this version of xcsh only supports ${CURRENT_EXPORT_VERSION}.`,
			);
		}

		// 3. Masked-token gate
		if (b.tokensMasked === true) {
			throw new ProfileError(
				"Bundle contains masked tokens. Re-export with --include-token to produce an importable bundle.",
			);
		}

		// 4. Per-profile field-shape
		const rawProfiles = b.profiles as unknown[];
		const normalized: F5XCProfile[] = [];
		const badNames: string[] = [];
		for (let i = 0; i < rawProfiles.length; i++) {
			const raw = rawProfiles[i];
			const rawObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
			const name = typeof rawObj.name === "string" ? rawObj.name : `<entry ${i}>`;
			if (typeof rawObj.name !== "string" || !this.#isValidProfileName(rawObj.name)) {
				badNames.push(`${name} (invalid name)`);
				continue;
			}
			const shape = this.#validateProfileShape(raw, rawObj.name);
			if (!shape) {
				badNames.push(`${rawObj.name} (invalid shape)`);
				continue;
			}
			normalized.push(shape);
		}
		if (badNames.length > 0) {
			throw new ProfileError(`Import bundle has ${badNames.length} invalid profile(s): ${badNames.join(", ")}.`);
		}

		// 4.5. Intra-bundle duplicate-name rejection. A bundle listing the
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
			throw new ProfileError(
				`Import bundle contains duplicate profile name(s): ${[...intraDuplicates].join(", ")}. Each name must appear at most once.`,
			);
		}

		// 5. Conflict detection — fresh disk read, NOT listProfileNamesCached
		const existing = await this.listProfiles();
		const existingNames = new Set(existing.map(p => p.name));
		const conflicts = normalized.filter(p => existingNames.has(p.name)).map(p => p.name);
		if (conflicts.length > 0 && !opts.overwrite) {
			throw new ProfileError(
				`${conflicts.length} profile(s) conflict: ${conflicts.join(", ")}. Re-run with --overwrite to replace, or delete conflicts first.`,
			);
		}

		// 6. Write loop — atomic per-file
		fs.mkdirSync(this.profilesDir, { recursive: true, mode: 0o700 });
		const imported: string[] = [];
		const overwritten: string[] = [];
		for (const profile of normalized) {
			const filePath = path.join(this.profilesDir, `${profile.name}.json`);
			const wasExisting = existingNames.has(profile.name);
			const payload: F5XCProfile = {
				...profile,
				version: profile.version ?? CURRENT_SCHEMA_VERSION,
				metadata: profile.metadata ?? { createdAt: new Date().toISOString() },
			};
			this.#atomicWrite(filePath, JSON.stringify(payload, null, 2));
			imported.push(profile.name);
			if (wasExisting) overwritten.push(profile.name);
		}

		// 7. Cache refresh
		await this.listProfiles();

		// 8. Refresh active-profile state if its backing file was overwritten.
		// importProfiles's write loop replaces the on-disk JSON, but #activeProfile,
		// Settings.bash.environment (apiUrl/apiToken/namespace), and the cached
		// auth metadata all hold a snapshot from the prior activate() call. Without
		// this step, a successful `/profile import --overwrite` that touches the
		// active profile leaves the session talking to the wrong tenant with the
		// wrong token until the user restarts or re-activates manually.
		const activeName = this.#activeProfile?.name;
		if (activeName && overwritten.includes(activeName)) {
			await this.activate(activeName);
		}

		return { imported, overwritten, skipped: [] };
	}

	/**
	 * Rename a profile. File is renamed first (atomic rename(2)); if the profile
	 * is active, active_profile is then updated to point at the new name. If the
	 * pointer update fails, the file rename is rolled back.
	 *
	 * Throws ProfileError for invalid names, missing source, or a target name
	 * that already exists. If the pointer-write rollback itself fails, logs a
	 * warning and throws a ProfileError documenting the inconsistent filesystem
	 * state for manual recovery.
	 *
	 * Fires onProfileChange listeners when the active profile is renamed.
	 *
	 * Note: does not rewrite the JSON body's "name" field. #readProfile treats
	 * the filename as canonical identity, so the stale field is inert.
	 */
	async renameProfile(oldName: string, newName: string): Promise<void> {
		this.#validateProfileName(oldName);
		this.#validateProfileName(newName);

		const oldPath = path.join(this.profilesDir, `${oldName}.json`);
		const newPath = path.join(this.profilesDir, `${newName}.json`);

		// Existence check fires BEFORE the identity short-circuit so
		// `renameProfile("ghost", "ghost")` returns the expected not-found error
		// instead of a silent success that hides a typo.
		if (!fs.existsSync(oldPath)) {
			throw new ProfileError(`Profile '${oldName}' not found.`, oldName);
		}
		if (oldName === newName) return;
		if (fs.existsSync(newPath)) {
			throw new ProfileError(`Profile '${newName}' already exists.`, newName);
		}

		// Step 1: rename file (atomic rename(2) on the same filesystem)
		fs.renameSync(oldPath, newPath);

		// Step 2: if renaming the active profile, update the pointer. On failure
		// we must roll back the file rename so the user sees a consistent state.
		const wasActive = this.#activeProfile?.name === oldName;
		if (wasActive) {
			try {
				this.#atomicWrite(this.activeProfilePath, newName);
			} catch (err) {
				// Rollback. Inner try wraps ONLY the rename-back call so the
				// rollback-succeeded / rollback-failed paths are clearly separated.
				try {
					fs.renameSync(newPath, oldPath);
				} catch (rollbackErr) {
					logger.warn("F5XC profile rename rollback failed — manual recovery required", {
						oldName,
						newName,
						originalError: String(err),
						rollbackError: String(rollbackErr),
					});
					throw new ProfileError(
						`Rename failed and rollback failed. Filesystem state: profiles/${newName}.json exists, active_profile still points at '${oldName}'. Manually rename profiles/${newName}.json back to profiles/${oldName}.json, or update active_profile to '${newName}'. Original error: ${err instanceof Error ? err.message : String(err)}. Rollback error: ${String(rollbackErr)}`,
						oldName,
					);
				}
				// Rollback succeeded — throw the user-friendly error.
				throw new ProfileError(
					`Failed to update active profile pointer: ${err instanceof Error ? err.message : String(err)}. Profile was not renamed.`,
					oldName,
				);
			}
		}

		// Step 3: update cache + active-profile pointer in memory.
		// Private-static listener access uses the same idiom as #applyToSettings
		// (the loop `for (const cb of ProfileService.#onProfileChangeListeners)`
		// already appears in that method) — direct `ProfileService.#name` access
		// from inside the class body.
		this.#profilesCache = this.#profilesCache
			.map(p => (p.name === oldName ? { ...p, name: newName } : p))
			.sort((a, b) => a.name.localeCompare(b.name));
		if (wasActive && this.#activeProfile) {
			this.#activeProfile = { ...this.#activeProfile, name: newName };
			for (const cb of ProfileService.#onProfileChangeListeners) {
				cb(this.#activeProfile);
			}
		}
	}

	/** Add or update environment variables on a profile. Keys matching secret
	 *  naming patterns are automatically added to sensitiveKeys. */
	async setEnvVars(name: string, vars: Record<string, string>): Promise<{ sensitive: string[] }> {
		this.#validateProfileName(name);
		const profile = this.#readProfile(name);
		if (!profile) throw new ProfileError(`Profile '${name}' not found.`, name);

		this.#assertCompatibleVersion(profile);

		const env = { ...(profile.env ?? {}), ...vars };
		const sensitiveSet = new Set(profile.sensitiveKeys ?? []);
		const newSensitive: string[] = [];
		for (const key of Object.keys(vars)) {
			if (SECRET_ENV_PATTERNS.test(key) && !sensitiveSet.has(key)) {
				sensitiveSet.add(key);
				newSensitive.push(key);
			}
		}
		// Remove sensitiveKeys entries for keys no longer in env
		const sensitiveKeys = [...sensitiveSet].filter(k => k in env);

		const updated: F5XCProfile = {
			...profile,
			env,
			sensitiveKeys: sensitiveKeys.length > 0 ? sensitiveKeys : undefined,
		};
		const profilePath = path.join(this.profilesDir, `${name}.json`);
		this.#atomicWrite(profilePath, JSON.stringify(updated, null, 2));
		this.#profilesCache = this.#profilesCache.map(p => (p.name === name ? updated : p));

		if (this.#activeProfile?.name === name) {
			this.#activeProfile = updated;
			this.#applyToSettings(updated);
		}
		return { sensitive: newSensitive };
	}

	/** Remove environment variables from a profile. Also removes them from sensitiveKeys. */
	async unsetEnvVars(name: string, keys: string[]): Promise<{ removed: string[] }> {
		this.#validateProfileName(name);
		const profile = this.#readProfile(name);
		if (!profile) throw new ProfileError(`Profile '${name}' not found.`, name);

		this.#assertCompatibleVersion(profile);

		const env = { ...(profile.env ?? {}) };
		const removed: string[] = [];
		for (const key of keys) {
			if (key in env) {
				delete env[key];
				removed.push(key);
			}
		}
		if (removed.length === 0) return { removed: [] };

		const keySet = new Set(keys);
		const sensitiveKeys = (profile.sensitiveKeys ?? []).filter(k => !keySet.has(k) && k in env);
		const envOrUndefined = Object.keys(env).length > 0 ? env : undefined;

		const updated: F5XCProfile = {
			...profile,
			env: envOrUndefined,
			sensitiveKeys: sensitiveKeys.length > 0 ? sensitiveKeys : undefined,
		};
		const profilePath = path.join(this.profilesDir, `${name}.json`);
		this.#atomicWrite(profilePath, JSON.stringify(updated, null, 2));
		this.#profilesCache = this.#profilesCache.map(p => (p.name === name ? updated : p));

		if (this.#activeProfile?.name === name) {
			this.#activeProfile = updated;
			this.#applyToSettings(updated);
		}
		return { removed };
	}

	async validateToken(options?: {
		timeoutMs?: number;
		apiUrl?: string;
		apiToken?: string;
	}): Promise<{ status: AuthStatus; latencyMs?: number; errorClass?: "network" | "credential" }> {
		// Use explicit credentials if provided (for non-active profiles or env-backed sessions),
		// otherwise fall back to effective credentials (env override > active profile)
		const effectiveUrl = options?.apiUrl ?? process.env[F5XC_API_URL] ?? this.#activeProfile?.apiUrl;
		const effectiveToken = options?.apiToken ?? process.env[F5XC_API_TOKEN] ?? this.#activeProfile?.apiToken;
		if (!effectiveUrl || !effectiveToken) return { status: "unknown" };

		// Ad-hoc mode: caller is validating credentials that DIFFER from the active/effective
		// ones — e.g., `/profile show <other>` passes a non-active profile's apiUrl/apiToken.
		// In that case, do NOT touch the cached auth state — getStatus() would otherwise report
		// the active profile's identity with some other profile's latency/status.
		//
		// `/profile show` on the ACTIVE profile (and `/profile show` with no name, which resolves
		// to the active name) also passes explicit creds via handleShow, but those creds match
		// the active/effective ones, so we DO want to refresh the cache — a user running
		// /profile show on the active profile is explicitly requesting a fresh validation.
		const activeUrl = process.env[F5XC_API_URL] ?? this.#activeProfile?.apiUrl;
		const activeToken = process.env[F5XC_API_TOKEN] ?? this.#activeProfile?.apiToken;
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
			});
			const latencyMs = Math.round(performance.now() - start);
			if (!adHoc) {
				this.#lastAuthLatencyMs = latencyMs;
				this.#lastAuthCheckedAt = checkedAt;
			}
			if (response.ok) {
				if (!adHoc) this.#authStatus = "connected";
				// Populate the namespace cache only when:
				//   - the EFFECTIVE credentials (after env-override resolution) match the
				//     active profile's stored credentials, AND
				//   - the session is NOT mixed-source (no F5XC_API_TOKEN / F5XC_NAMESPACE
				//     env override). In a mixed session, the activate → handleShow path
				//     passes the profile's own token as options, so effective matches
				//     active even though the user's actual operational credentials are
				//     the env override. Suppressing the cache in that case prevents the
				//     namespace dropdown from showing a list from the profile's account
				//     when later API ops would run under the override's account.
				//
				// Cases handled correctly after these combined guards:
				//   - startup and `/profile activate → handleShow` (no env override): populate
				//   - `/profile show <other>` (mismatched explicit creds): skip via effective
				//   - env-backed session (no active profile): skip via active !== null
				//   - mixed-source / `F5XC_API_TOKEN` override: skip via !hasEnvOverride
				const active = this.#activeProfile;
				const isForActiveProfile =
					!hasEnvOverride() &&
					active !== null &&
					effectiveUrl === active.apiUrl &&
					effectiveToken === active.apiToken;
				if (isForActiveProfile) {
					// Fire-and-forget: body parse runs in the background so the auth result
					// returns on headers. Large namespace lists or slow proxies cannot stall
					// /profile status, /profile show, or startup validation on this path.
					// The captured epoch guards against stale writes: if `activate()` runs
					// while the body is still parsing, the epoch advances and this callback
					// discards its result.
					const epochAtFetch = this.#activationEpoch;
					response
						.json()
						.then(body => {
							if (this.#activationEpoch !== epochAtFetch) return;
							const items = (body as { items?: unknown })?.items;
							if (Array.isArray(items)) {
								const names = (items as unknown[])
									.map(i =>
										typeof i === "object" && i !== null && "name" in i
											? (i as { name: unknown }).name
											: undefined,
									)
									.filter((n): n is string => typeof n === "string");
								this.#namespacesCache = [...names].sort((a, b) => a.localeCompare(b));
							}
						})
						.catch(() => {
							// Body not JSON or parse failed — leave cache untouched.
						});
				}
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
	 * Validate credentials for a named profile without switching the active one.
	 * Uses validateToken's ad-hoc branch (explicit apiUrl + apiToken), so no
	 * cached auth state, namespace cache, or active profile is mutated.
	 *
	 * Throws ProfileError when the name is invalid, the profile is missing, or
	 * the profile's schema version is incompatible. Auth failure is not thrown:
	 * it is returned as ValidationResult.status = "auth_error" / "offline".
	 */
	async validateProfileByName(name: string): Promise<ValidationResult> {
		this.#validateProfileName(name);
		const profile = this.#readProfile(name);
		if (!profile) {
			throw new ProfileError(`Profile '${name}' not found.`, name);
		}
		this.#assertCompatibleVersion(profile);
		const { status, latencyMs, errorClass } = await this.validateToken({
			apiUrl: profile.apiUrl,
			apiToken: profile.apiToken,
		});
		return { profile, status, latencyMs, errorClass };
	}

	setNamespace(namespace: string): void {
		if (!this.#activeProfile) {
			throw new ProfileError("No active profile. Run `/profile activate <name>` to select one.");
		}
		this.#activeProfile = { ...this.#activeProfile, defaultNamespace: namespace };
		// Re-apply settings with the new namespace
		this.#applyToSettings(this.#activeProfile);
		this.#credentialSource = hasEnvOverride() ? "mixed" : "profile";
	}

	getStatus(): ProfileStatus {
		const url = process.env[F5XC_API_URL] ?? this.#activeProfile?.apiUrl ?? null;
		const tenant = url ? deriveTenantFromUrl(url) : null;
		return {
			activeProfileName: this.#activeProfile?.name ?? null,
			activeProfileUrl: url,
			activeProfileTenant: tenant,
			activeProfileNamespace: process.env[F5XC_NAMESPACE] ?? this.#activeProfile?.defaultNamespace ?? null,
			credentialSource: this.#credentialSource,
			authStatus: this.#authStatus,
			isConfigured: this.#credentialSource !== "none",
			authLatencyMs: this.#lastAuthLatencyMs,
			authCheckedAt: this.#lastAuthCheckedAt,
		};
	}

	/** Sync list of env var keys on the active profile, sorted. [] if no active profile. */
	getActiveEnvKeys(): string[] {
		return Object.keys(this.#activeProfile?.env ?? {}).sort();
	}

	/** Sync list of known profile names, sorted. [] before the first listProfiles()/loadActive(). */
	listProfileNamesCached(): string[] {
		return this.#profilesCache.map(p => p.name);
	}

	/**
	 * Sync hint for a profile name. Used by the `/profile activate` completion
	 * to display the tenant URL and a schema-incompatibility badge.
	 * Returns null if the name is not in the cache.
	 * `incompatible` is always set; `schemaVersion` is set only when incompatible.
	 */
	getProfileHint(name: string): { apiUrl?: string; incompatible: boolean; schemaVersion?: number } | null {
		const profile = this.#profilesCache.find(p => p.name === name);
		if (!profile) return null;
		const version = profile.version;
		const incompatible = version !== undefined && version > CURRENT_SCHEMA_VERSION;
		return {
			apiUrl: profile.apiUrl,
			incompatible,
			...(incompatible ? { schemaVersion: version } : {}),
		};
	}

	/** Sync namespace names from the most recent successful validateToken response, sorted. */
	getCachedNamespaces(): string[] {
		return [...this.#namespacesCache];
	}

	maskToken(token: string): string {
		if (token.length <= 4) return "****";
		return `...${token.slice(-4)}`;
	}

	// --- Private helpers ---

	#atomicWrite(filePath: string, content: string): void {
		const tmpPath = `${filePath}.tmp`;
		fs.writeFileSync(tmpPath, content);
		fs.renameSync(tmpPath, filePath);
	}

	#isValidProfileName(name: string): boolean {
		return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
	}

	#validateProfileName(name: string): void {
		if (!this.#isValidProfileName(name)) {
			throw new ProfileError(
				`Invalid profile name: '${name}'. Names must be alphanumeric with dashes/underscores, max 64 chars.`,
				name,
			);
		}
	}

	#assertCompatibleVersion(profile: F5XCProfile): void {
		if (profile.version !== undefined && profile.version > CURRENT_SCHEMA_VERSION) {
			throw new ProfileError(
				`Profile '${profile.name}' uses schema version ${profile.version}, but this version of xcsh only supports version ${CURRENT_SCHEMA_VERSION}. Upgrade xcsh to use this profile, or run \`/profile create\` to create a new one.`,
				profile.name,
			);
		}
	}

	#readActiveProfileName(): string | null {
		try {
			if (!fs.existsSync(this.activeProfilePath)) return null;
			const name = fs.readFileSync(this.activeProfilePath, "utf-8").trim();
			if (!name) return null;
			// Validate to prevent path traversal from crafted active_profile files
			if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
				logger.warn("F5XC active_profile contains invalid name", { name });
				return null;
			}
			return name;
		} catch {
			return null;
		}
	}

	/**
	 * Field-shape check for a parsed profile object. Returns a normalized
	 * F5XCProfile when obj passes the same rules #readProfile enforces on disk
	 * reads, or null when a required field is missing/wrong-typed.
	 *
	 * Used by #readProfile (canonical name = filename) and by importProfiles
	 * (canonical name = obj.name, which the caller must already have validated
	 * via #isValidProfileName).
	 *
	 * Side effect: logger.warn on failure, matching #readProfile's original
	 * behavior so existing log-assertion tests continue to pass.
	 */
	#validateProfileShape(obj: unknown, canonicalName: string): F5XCProfile | null {
		if (!obj || typeof obj !== "object") {
			logger.warn("F5XC profile is not an object", { name: canonicalName });
			return null;
		}
		const parsed = obj as Record<string, unknown>;

		if (
			!parsed.apiUrl ||
			typeof parsed.apiUrl !== "string" ||
			!parsed.apiToken ||
			typeof parsed.apiToken !== "string"
		) {
			logger.warn("F5XC profile missing or invalid required fields", { name: canonicalName });
			return null;
		}
		if (parsed.defaultNamespace && typeof parsed.defaultNamespace !== "string") {
			logger.warn("F5XC profile has non-string defaultNamespace", { name: canonicalName });
			return null;
		}

		let env: Record<string, string> | undefined;
		if (parsed.env && typeof parsed.env === "object" && !Array.isArray(parsed.env)) {
			env = {};
			for (const [k, v] of Object.entries(parsed.env)) {
				if (typeof v === "string") env[k] = v;
			}
			if (Object.keys(env).length === 0) env = undefined;
		}

		let sensitiveKeys: string[] | undefined;
		if (Array.isArray(parsed.sensitiveKeys) && env) {
			const filtered = parsed.sensitiveKeys.filter((k: unknown): k is string => typeof k === "string" && k in env);
			sensitiveKeys = filtered.length > 0 ? filtered : undefined;
		}

		return {
			name: canonicalName,
			apiUrl: parsed.apiUrl,
			apiToken: parsed.apiToken,
			defaultNamespace: typeof parsed.defaultNamespace === "string" ? parsed.defaultNamespace : "default",
			env,
			sensitiveKeys,
			version: typeof parsed.version === "number" ? parsed.version : undefined,
			metadata:
				parsed.metadata && typeof parsed.metadata === "object" && !Array.isArray(parsed.metadata)
					? (parsed.metadata as F5XCProfile["metadata"])
					: undefined,
		};
	}

	#readProfile(name: string): F5XCProfile | null {
		const filePath = path.join(this.profilesDir, `${name}.json`);
		try {
			if (!fs.existsSync(filePath)) {
				logger.warn("F5XC profile file not found", { name, path: filePath });
				return null;
			}
			const content = fs.readFileSync(filePath, "utf-8");
			const parsed = JSON.parse(content);
			return this.#validateProfileShape(parsed, name);
		} catch (err) {
			logger.warn("F5XC profile read error", { name, error: String(err) });
			return null;
		}
	}

	#listProfileFiles(): string[] {
		try {
			if (!fs.existsSync(this.profilesDir)) return [];
			return fs.readdirSync(this.profilesDir).filter(f => f.endsWith(".json"));
		} catch {
			return [];
		}
	}

	#applyToSettings(profile: F5XCProfile): void {
		// Per-field merge: skip any key already in process.env (subprocess inherits
		// it directly), inject profile values for the rest. This avoids both
		// overriding explicit env vars AND losing profile values for unset keys.
		const existing = (Settings.instance.get("bash.environment") ?? {}) as Record<string, string>;
		// Preserve non-F5XC keys (user-defined HTTP_PROXY, PATH, etc.) but clear
		// all F5XC_* keys to prevent stale credentials leaking across profile switches
		const merged: Record<string, string> = {};
		for (const [key, value] of Object.entries(existing)) {
			if (!key.startsWith("F5XC_")) merged[key] = value;
		}
		if (!process.env[F5XC_API_URL]) merged[F5XC_API_URL] = profile.apiUrl;
		if (!process.env[F5XC_API_TOKEN]) merged[F5XC_API_TOKEN] = profile.apiToken;
		if (!process.env[F5XC_NAMESPACE]) merged[F5XC_NAMESPACE] = profile.defaultNamespace;

		// Auto-derive F5XC_TENANT from first hostname label of apiUrl
		if (!process.env[F5XC_TENANT]) {
			const tenant = deriveTenantFromUrl(profile.apiUrl);
			if (tenant) merged[F5XC_TENANT] = tenant;
		}

		// Inject all additional env vars from profile.env map
		if (profile.env) {
			for (const [key, value] of Object.entries(profile.env)) {
				if (!process.env[key]) merged[key] = value;
			}
		}

		Settings.instance.override("bash.environment", merged);

		// Notify listeners (e.g. obfuscator refresh) about the profile change.
		for (const cb of ProfileService.#onProfileChangeListeners) {
			cb(profile);
		}
	}
}
