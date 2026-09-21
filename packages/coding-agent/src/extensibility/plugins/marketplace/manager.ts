/**
 * MarketplaceManager — orchestrates registry, fetcher, resolver, and cache.
 *
 * Constructor takes explicit paths for testability (same pattern as registry.ts).
 * The `clearPluginRootsCache` dependency is injected so callers can provide
 * the real `clearXcshPluginRootsCache` while tests supply a counter stub.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { isEnoent, logger } from "@f5-sales-demo/pi-utils";

import {
	BUILTIN_MARKETPLACE_NAME,
	createBuiltinMarketplaceEntry,
	getBuiltinMarketplaceSnapshot,
	isBuiltinMarketplaceSource,
} from "./builtin";
import { cachePlugin } from "./cache";
import { classifySource, fetchMarketplace, parseMarketplaceCatalog, promoteCloneToCache } from "./fetcher";
import {
	addInstalledPlugin,
	addMarketplaceEntry,
	collectReferencedPaths,
	getInstalledPlugin,
	getMarketplaceEntry,
	readInstalledPluginsRegistry,
	readMarketplacesRegistry,
	removeInstalledPlugin,
	removeMarketplaceEntry,
	writeInstalledPluginsRegistry,
	writeMarketplacesRegistry,
} from "./registry";
import { resolvePluginSource } from "./source-resolver";
import type {
	InstalledPluginEntry,
	InstalledPluginSummary,
	InstalledPluginsRegistry,
	MarketplaceCatalog,
	MarketplacePluginEntry,
	MarketplaceRegistryEntry,
} from "./types";
import { buildPluginId, isInstalledPluginEffectivelyEnabled, parsePluginId } from "./types";

// ── Options ──────────────────────────────────────────────────────────────────

export interface MarketplaceManagerOptions {
	marketplacesRegistryPath: string;
	installedRegistryPath: string;
	/**
	 * Path to the project-scoped installed_plugins.json.
	 * Required when installPlugin / uninstallPlugin is called with scope: "project".
	 * Resolved by resolveActiveProjectRegistryPath(cwd) in callers.
	 */
	projectInstalledRegistryPath?: string;
	/**
	 * Path to the local-scoped installed_plugins.json (gitignored, project-specific).
	 * Same as project path but under a `.local` variant so it stays out of VCS.
	 */
	localInstalledRegistryPath?: string;
	marketplacesCacheDir: string;
	pluginsCacheDir: string;
	/** Injected for testing; production callers pass clearXcshPluginRootsCache.
	 *  Receives any additional file paths that should also be invalidated from the fs cache.
	 */
	clearPluginRootsCache?: (extraPaths?: readonly string[]) => void;
	/** Test-only escape hatch; production always includes the built-in marketplace. */
	includeBuiltinMarketplace?: boolean;
}

export interface PluginUpdate {
	pluginId: string;
	scope: "user" | "project" | "local";
	from: string;
	to: string;
}

export interface MarketplaceRefreshResult {
	successful: string[];
	failed: string[];
}

export interface MarketplaceCatalogPreview extends MarketplaceRefreshResult {
	plugins: Array<{ marketplace: string; plugin: MarketplacePluginEntry }>;
}

// ── Manager ──────────────────────────────────────────────────────────────────

export class MarketplaceManager {
	#opts: MarketplaceManagerOptions;

	constructor(options: MarketplaceManagerOptions) {
		this.#opts = options;
	}

	// Invalidate fs caches for all registry paths the manager writes, then clear plugin roots.
	#clearCache(): void {
		const extra = this.#opts.projectInstalledRegistryPath
			? ([this.#opts.projectInstalledRegistryPath] as readonly string[])
			: undefined;
		this.#opts.clearPluginRootsCache?.(extra);
	}

	async #readMarketplacesRegistry(): Promise<Awaited<ReturnType<typeof readMarketplacesRegistry>>> {
		const reg = await readMarketplacesRegistry(this.#opts.marketplacesRegistryPath);
		if (this.#opts.includeBuiltinMarketplace === false) return reg;
		const catalogPath = path.join(this.#opts.marketplacesCacheDir, BUILTIN_MARKETPLACE_NAME, "marketplace.json");
		const canonical = createBuiltinMarketplaceEntry(catalogPath);
		const existing = reg.marketplaces.find(entry => entry.name === BUILTIN_MARKETPLACE_NAME);
		const reconciled = existing
			? {
					...existing,
					name: canonical.name,
					sourceType: canonical.sourceType,
					sourceUri: canonical.sourceUri,
					catalogPath: canonical.catalogPath,
					enabled: existing.enabled !== false,
					builtIn: true,
				}
			: canonical;
		const marketplaces = [
			reconciled,
			...reg.marketplaces.filter(
				entry => entry.name !== BUILTIN_MARKETPLACE_NAME && !isBuiltinMarketplaceSource(entry.sourceUri),
			),
		];
		const updated = { version: 2 as const, marketplaces };

		const { json: snapshot } = getBuiltinMarketplaceSnapshot();
		let catalogUsable = false;
		try {
			parseMarketplaceCatalog(await Bun.file(catalogPath).text(), catalogPath);
			catalogUsable = true;
		} catch {
			// A missing or invalid cache is repaired from the integrity-checked embedded snapshot.
		}
		if (!catalogUsable) {
			await fs.mkdir(path.dirname(catalogPath), { recursive: true });
			await Bun.write(catalogPath, snapshot);
		}

		if (JSON.stringify(updated) !== JSON.stringify(reg)) {
			await writeMarketplacesRegistry(this.#opts.marketplacesRegistryPath, updated);
		}
		return updated;
	}

	// ── Marketplace lifecycle ─────────────────────────────────────────────────

	async addMarketplace(
		source: string,
		validateCatalogBeforeCommit?: (catalog: MarketplaceCatalog) => void,
	): Promise<MarketplaceRegistryEntry> {
		const reg = await this.#readMarketplacesRegistry();
		if (isBuiltinMarketplaceSource(source)) {
			throw new Error(`Marketplace "${BUILTIN_MARKETPLACE_NAME}" is built in and its canonical source is reserved.`);
		}
		const existingNames = new Set(reg.marketplaces.map(m => m.name));

		const { catalog, clonePath } = await fetchMarketplace(source, this.#opts.marketplacesCacheDir);
		try {
			validateCatalogBeforeCommit?.(catalog);
		} catch (error) {
			if (clonePath) await fs.rm(clonePath, { recursive: true, force: true }).catch(() => {});
			throw error;
		}

		if (existingNames.has(catalog.name)) {
			if (clonePath) {
				await fs.rm(clonePath, { recursive: true, force: true }).catch(() => {});
			}
			throw new Error(`Marketplace "${catalog.name}" already exists`);
		}

		// Promote the temp clone to its final cache location now that we know it's not a duplicate.
		if (clonePath) {
			await promoteCloneToCache(clonePath, this.#opts.marketplacesCacheDir, catalog.name);
		}

		const sourceType = classifySource(source);
		const normalizedSource =
			sourceType === "local"
				? path.resolve(source.startsWith("~/") ? path.join(os.homedir(), source.slice(2)) : source)
				: source;

		const catalogPath = path.join(this.#opts.marketplacesCacheDir, catalog.name, "marketplace.json");

		// Persist the fetched catalog so subsequent reads don't require re-fetching.
		await Bun.write(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

		const now = new Date().toISOString();
		const entry: MarketplaceRegistryEntry = {
			name: catalog.name,
			sourceType,
			sourceUri: normalizedSource,
			catalogPath,
			addedAt: now,
			updatedAt: now,
			enabled: true,
			builtIn: false,
		};

		const updated = addMarketplaceEntry(reg, entry);
		await writeMarketplacesRegistry(this.#opts.marketplacesRegistryPath, updated);

		logger.debug("Marketplace added", { name: catalog.name, sourceType });
		return entry;
	}

	async removeMarketplace(name: string): Promise<void> {
		const reg = await this.#readMarketplacesRegistry();
		const existing = getMarketplaceEntry(reg, name);
		if (existing?.builtIn) {
			throw new Error(`Marketplace "${name}" is built in and cannot be removed. Disable it instead.`);
		}
		// removeMarketplaceEntry throws if not found — propagate to caller.
		const updated = removeMarketplaceEntry(reg, name);
		await writeMarketplacesRegistry(this.#opts.marketplacesRegistryPath, updated);

		await fs.rm(path.join(this.#opts.marketplacesCacheDir, name), {
			recursive: true,
			force: true,
		});

		logger.debug("Marketplace removed", { name });
	}

	async updateMarketplace(name: string): Promise<MarketplaceRegistryEntry> {
		const reg = await this.#readMarketplacesRegistry();
		const existing = getMarketplaceEntry(reg, name);
		if (!existing) {
			throw new Error(`Marketplace "${name}" not found`);
		}
		if (!existing.enabled) {
			throw new Error(`Marketplace "${name}" is disabled. Enable it before updating.`);
		}

		const fetchResult: { catalog: MarketplaceCatalog; clonePath?: string } = await fetchMarketplace(
			existing.sourceUri,
			this.#opts.marketplacesCacheDir,
		);
		const { catalog, clonePath } = fetchResult;

		// Guard against upstream catalog silently renaming itself — the registry
		// entry is keyed by name, so a drift would corrupt the entry on next read.
		if (catalog.name !== name) {
			if (clonePath) {
				await fs.rm(clonePath, { recursive: true, force: true }).catch(() => {});
			}
			throw new Error(
				`Marketplace catalog name changed from "${name}" to "${catalog.name}". ` +
					`Remove and re-add the marketplace to update.`,
			);
		}

		// Promote the temp clone to its final cache location now that drift check passed.
		if (clonePath) {
			await promoteCloneToCache(clonePath, this.#opts.marketplacesCacheDir, catalog.name);
		}

		// Overwrite cached catalog
		await Bun.write(existing.catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

		const updatedEntry: MarketplaceRegistryEntry = {
			...existing,
			updatedAt: new Date().toISOString(),
		};

		const updatedReg = {
			...reg,
			marketplaces: reg.marketplaces.map(m => (m.name === name ? updatedEntry : m)),
		};
		await writeMarketplacesRegistry(this.#opts.marketplacesRegistryPath, updatedReg);

		logger.debug("Marketplace updated", { name });
		return updatedEntry;
	}

	async updateAllMarketplaces(): Promise<MarketplaceRegistryEntry[]> {
		const marketplaces = (await this.listMarketplaces()).filter(marketplace => marketplace.enabled);
		const results: MarketplaceRegistryEntry[] = [];
		for (const m of marketplaces) {
			const updated = await this.updateMarketplace(m.name);
			results.push(updated);
		}
		return results;
	}

	async listMarketplaces(): Promise<MarketplaceRegistryEntry[]> {
		const reg = await this.#readMarketplacesRegistry();
		return reg.marketplaces;
	}

	async setMarketplaceEnabled(name: string, enabled: boolean): Promise<MarketplaceRegistryEntry> {
		const reg = await this.#readMarketplacesRegistry();
		const existing = getMarketplaceEntry(reg, name);
		if (!existing) throw new Error(`Marketplace "${name}" not found`);
		if (existing.enabled === enabled) return existing;
		const now = new Date().toISOString();
		const updatedEntry: MarketplaceRegistryEntry = {
			...existing,
			enabled,
			...(!enabled ? { pluginsDisabledAt: now } : {}),
		};
		await writeMarketplacesRegistry(this.#opts.marketplacesRegistryPath, {
			...reg,
			marketplaces: reg.marketplaces.map(entry => (entry.name === name ? updatedEntry : entry)),
		});
		this.#clearCache();
		return updatedEntry;
	}

	/**
	 * Best-effort interactive refresh. Unlike refreshStaleMarketplaces(), this always
	 * fetches every selected marketplace and isolates failures so cached catalogs remain usable.
	 */
	async refreshMarketplaces(names?: readonly string[]): Promise<MarketplaceRefreshResult> {
		const enabled = (await this.listMarketplaces()).filter(marketplace => marketplace.enabled);
		const enabledNames = new Set(enabled.map(marketplace => marketplace.name));
		const selected = names ?? [...enabledNames];
		const result: MarketplaceRefreshResult = { successful: [], failed: [] };

		for (const name of new Set(selected)) {
			if (!enabledNames.has(name)) continue;
			try {
				await this.updateMarketplace(name);
				result.successful.push(name);
			} catch (error) {
				logger.debug("Interactive marketplace refresh failed; preserving cached catalog", {
					name,
					error: String(error),
				});
				result.failed.push(name);
			}
		}

		return result;
	}

	/** Fetch current catalogs without mutating persistent state (used by dry-run workflows). */
	async previewMarketplacePlugins(names?: readonly string[]): Promise<MarketplaceCatalogPreview> {
		const reg = await this.#readMarketplacesRegistry();
		const enabledMarketplaces = reg.marketplaces.filter(marketplace => marketplace.enabled);
		const selectedNames = names ?? enabledMarketplaces.map(marketplace => marketplace.name);
		const selected = new Map(enabledMarketplaces.map(marketplace => [marketplace.name, marketplace]));
		const previewDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-marketplace-preview-"));
		const result: MarketplaceCatalogPreview = {
			successful: [],
			failed: [],
			plugins: [],
		};

		try {
			for (const name of new Set(selectedNames)) {
				const marketplace = selected.get(name);
				if (!marketplace) {
					result.failed.push(name);
					continue;
				}

				let catalog: MarketplaceCatalog | undefined;
				try {
					const fetched = await fetchMarketplace(marketplace.sourceUri, previewDir);
					if (fetched.catalog.name !== name) {
						throw new Error(`Marketplace catalog name changed from "${name}" to "${fetched.catalog.name}".`);
					}
					catalog = fetched.catalog;
					result.successful.push(name);
				} catch (error) {
					logger.debug("Marketplace preview refresh failed; using cached catalog when available", {
						name,
						error: String(error),
					});
					result.failed.push(name);
					catalog = await this.#readCatalog(marketplace).catch(() => undefined);
				}

				for (const plugin of catalog?.plugins ?? []) result.plugins.push({ marketplace: name, plugin });
			}
			return result;
		} finally {
			await fs.rm(previewDir, { recursive: true, force: true });
		}
	}

	// ── Plugin discovery ──────────────────────────────────────────────────────

	async listAvailablePlugins(marketplace?: string): Promise<MarketplacePluginEntry[]> {
		const reg = await this.#readMarketplacesRegistry();

		if (marketplace !== undefined) {
			const entry = reg.marketplaces.find(m => m.name === marketplace);
			if (!entry) {
				throw new Error(`Marketplace "${marketplace}" not found`);
			}
			if (!entry.enabled) return [];
			const catalog = await this.#readCatalog(entry);
			return catalog.plugins;
		}

		const all: MarketplacePluginEntry[] = [];
		for (const entry of reg.marketplaces) {
			if (!entry.enabled) continue;
			try {
				const catalog = await this.#readCatalog(entry);
				all.push(...catalog.plugins);
			} catch (error) {
				logger.debug("Skipping unavailable marketplace catalog", {
					name: entry.name,
					error: String(error),
				});
			}
		}
		return all;
	}

	async getPluginInfo(name: string, marketplace: string): Promise<MarketplacePluginEntry | null> {
		const plugins = await this.listAvailablePlugins(marketplace);
		return plugins.find(p => p.name === name) ?? null;
	}

	// ── Install / uninstall ───────────────────────────────────────────────────

	async installPlugin(
		name: string,
		marketplace: string,
		options?: { force?: boolean; scope?: "user" | "project" | "local" },
	): Promise<InstalledPluginEntry> {
		const scope = options?.scope ?? "user";
		const marketplaces = await this.#readMarketplacesRegistry();
		const entry = getMarketplaceEntry(marketplaces, marketplace);
		if (!entry) throw new Error(`Marketplace "${marketplace}" not found`);
		const catalog = await this.#readCatalog(entry);
		const plan = this.#dependencyPlan(catalog, name);
		const registryPath = this.#registryPath(scope);
		const before = await readInstalledPluginsRegistry(registryPath);
		const introduced: string[] = [];
		let result: InstalledPluginEntry | undefined;
		try {
			for (const pluginName of plan) {
				const pluginId = buildPluginId(pluginName, marketplace);
				const wasInstalled = (before.plugins[pluginId]?.length ?? 0) > 0;
				// Dependencies are synchronized to the catalog before their dependent.
				result = await this.#installPluginOne(pluginName, marketplace, {
					scope,
					force: pluginName === name ? options?.force : true,
				});
				if (!wasInstalled) introduced.push(pluginId);
			}
		} catch (error) {
			let rollback = await readInstalledPluginsRegistry(registryPath);
			const staged = introduced.flatMap(pluginId => rollback.plugins[pluginId] ?? []);
			for (const pluginId of introduced.reverse()) rollback = removeInstalledPlugin(rollback, pluginId);
			await writeInstalledPluginsRegistry(registryPath, rollback);
			const [userRegistry, projectRegistry] = await Promise.all([
				readInstalledPluginsRegistry(this.#opts.installedRegistryPath),
				this.#opts.projectInstalledRegistryPath
					? readInstalledPluginsRegistry(this.#opts.projectInstalledRegistryPath)
					: Promise.resolve({
							version: 2 as const,
							plugins: {} as Record<string, InstalledPluginEntry[]>,
						}),
			]);
			const referenced = collectReferencedPaths(userRegistry, projectRegistry);
			for (const stagedEntry of staged) {
				if (!referenced.has(stagedEntry.installPath)) {
					await fs.rm(stagedEntry.installPath, {
						recursive: true,
						force: true,
					});
				}
			}
			this.#clearCache();
			throw error;
		}
		if (!result) throw new Error(`Plugin "${name}" not found in marketplace "${marketplace}"`);
		return result;
	}

	#dependencyPlan(catalog: MarketplaceCatalog, root: string): string[] {
		const plugins = new Map(catalog.plugins.map(plugin => [plugin.name, plugin]));
		const state = new Map<string, "visiting" | "visited">();
		const plan: string[] = [];
		const visit = (name: string, trail: string[]): void => {
			const plugin = plugins.get(name);
			if (!plugin) {
				if (trail.length === 0) throw new Error(`Plugin "${name}" not found in marketplace "${catalog.name}"`);
				throw new Error(`Plugin dependency "${name}" is missing from marketplace "${catalog.name}"`);
			}
			if (state.get(name) === "visiting")
				throw new Error(`Plugin dependency cycle: ${[...trail, name].join(" -> ")}`);
			if (state.get(name) === "visited") return;
			state.set(name, "visiting");
			for (const dependency of plugin.lifecycle.pluginDependencies) {
				if (dependency === name) throw new Error(`Plugin "${name}" cannot depend on itself`);
				visit(dependency, [...trail, name]);
			}
			state.set(name, "visited");
			plan.push(name);
		};
		visit(root, []);
		return plan;
	}

	async #installPluginOne(
		name: string,
		marketplace: string,
		options?: { force?: boolean; scope?: "user" | "project" | "local" },
	): Promise<InstalledPluginEntry> {
		const force = options?.force ?? false;
		const scope = options?.scope ?? "user";
		const registryPath = this.#registryPath(scope);

		// 1. Find marketplace entry
		const mktReg = await this.#readMarketplacesRegistry();
		const mktEntry = getMarketplaceEntry(mktReg, marketplace);
		if (!mktEntry) {
			throw new Error(`Marketplace "${marketplace}" not found`);
		}
		if (!mktEntry.enabled) {
			throw new Error(`Marketplace "${marketplace}" is disabled. Enable it before installing plugins.`);
		}

		// 2. Find plugin in catalog
		const catalog = await this.#readCatalog(mktEntry);
		const pluginEntry = catalog.plugins.find(p => p.name === name);
		if (!pluginEntry) {
			throw new Error(`Plugin "${name}" not found in marketplace "${marketplace}"`);
		}

		const pluginId = buildPluginId(name, marketplace);

		// 3. Check if already installed
		const instReg = await readInstalledPluginsRegistry(registryPath);
		const existing = getInstalledPlugin(instReg, pluginId);
		if (existing && existing.length > 0 && !force) {
			throw new Error(`Plugin "${pluginId}" is already installed. Use force option to reinstall.`);
		}

		// 4. Resolve source path.
		// marketplaceClonePath is the marketplace root — the directory containing .xcsh-plugin/
		// catalogPath is <marketplacesCacheDir>/<name>/marketplace.json, so the root is two levels up.
		// For local sources the content was fetched from a local path; the stored catalog is a copy
		// under marketplacesCacheDir. We need the original source root for resolving relative paths.
		// Use: path.dirname(catalogPath) is <cacheDir>/<name>/, and that IS the stored copy root,
		// so `path.resolve(mktEntry.catalogPath, "../..")` = parent of <name>/ inside cacheDir
		// which is wrong for local sources. Instead, derive from the stored catalog directory:
		// stored at: <marketplacesCacheDir>/<catalogName>/marketplace.json
		// The marketplace root for local sources should be the actual local path, but we only have
		// sourceUri. For local sources, use path.resolve of sourceUri; for others use the cache dir.
		const marketplaceClonePath = this.#resolveMarketplaceRoot(mktEntry);

		// URL-sourced marketplaces only cache marketplace.json, not the full plugin tree.
		// Relative string sources ("./plugins/foo") cannot be resolved against the cache dir.
		if (mktEntry.sourceType === "url" && typeof pluginEntry.source === "string") {
			throw new Error(
				`Plugin "${name}" uses a relative source path but marketplace "${marketplace}" was added via URL. ` +
					`Relative sources require a git or local marketplace. Re-add the marketplace using its git URL.`,
			);
		}

		const { dir: sourcePath, tempCloneRoot } = await resolvePluginSource(pluginEntry, {
			marketplaceClonePath,
			catalogMetadata: catalog.metadata,
			tmpDir: os.tmpdir(),
		});

		// 5. Determine version: catalog entry > plugin manifest > git SHA > fallback
		let version!: string;
		let cachePath!: string;
		try {
			version = await this.#resolvePluginVersion(pluginEntry, sourcePath);
			cachePath = await cachePlugin(sourcePath, this.#opts.pluginsCacheDir, marketplace, name, version);
		} finally {
			// Clean up temp clone dirs created by resolvePluginSource; leave user-supplied local dirs alone
			if (tempCloneRoot) {
				await fs.rm(tempCloneRoot, { recursive: true, force: true }).catch(() => {});
			}
		}

		// Only now clean up old entries — new cache succeeded, so it is safe to remove old ones.
		if (existing && existing.length > 0) {
			// Remove from scope-appropriate registry first, then cross-check refs before disk deletion.
			const prunedReg = removeInstalledPlugin(await readInstalledPluginsRegistry(registryPath), pluginId);
			await writeInstalledPluginsRegistry(registryPath, prunedReg);

			// Read both registries AFTER removal — only delete paths no longer referenced by either.
			const [userReg, projectReg] = await Promise.all([
				readInstalledPluginsRegistry(this.#opts.installedRegistryPath),
				this.#opts.projectInstalledRegistryPath
					? readInstalledPluginsRegistry(this.#opts.projectInstalledRegistryPath)
					: Promise.resolve({
							version: 2 as const,
							plugins: {} as Record<string, InstalledPluginEntry[]>,
						}),
			]);
			const referenced = collectReferencedPaths(userReg, projectReg);

			for (const entry of existing) {
				if (entry.installPath !== cachePath && !referenced.has(entry.installPath)) {
					await fs.rm(entry.installPath, { recursive: true, force: true });
				}
			}
		}

		// 6. Build and register the entry, preserving enabled state from previous install
		const now = new Date().toISOString();
		// Carry over enabled flag from existing entry — a disabled plugin must stay disabled after upgrade
		const wasDisabled = existing?.some(e => e.enabled === false);
		// Honor defaultEnabled from catalog — new installs with defaultEnabled: false start disabled
		const defaultDisabled = !existing && pluginEntry.defaultEnabled === false;
		const installedEntry: InstalledPluginEntry = {
			scope,
			installPath: cachePath,
			version,
			installedAt: now,
			lastUpdated: now,
			...(wasDisabled || defaultDisabled ? { enabled: false } : {}),
		};

		const freshInstReg = await readInstalledPluginsRegistry(registryPath);
		const newInstReg = addInstalledPlugin(freshInstReg, pluginId, installedEntry);
		await writeInstalledPluginsRegistry(registryPath, newInstReg);

		this.#clearCache();

		logger.debug("Plugin installed", { pluginId, version, cachePath });
		return installedEntry;
	}

	/**
	 * Resolve plugin version from multiple sources:
	 * 1. Catalog entry version (if set)
	 * 2. Plugin manifest (.xcsh-plugin/plugin.json or package.json)
	 * 3. Git SHA from source (truncated to 7 chars)
	 * 4. Fallback "0.0.0"
	 */
	async #resolvePluginVersion(entry: MarketplacePluginEntry, sourcePath: string): Promise<string> {
		// 1. Catalog entry version
		if (entry.version) return entry.version;

		// 2. Plugin manifest
		for (const manifestPath of [
			path.join(sourcePath, ".xcsh-plugin", "plugin.json"),
			path.join(sourcePath, "package.json"),
		]) {
			try {
				const content = await Bun.file(manifestPath).json();
				if (typeof content?.version === "string" && content.version) {
					return content.version;
				}
			} catch {
				// Missing or invalid — try next
			}
		}

		// 3. Git SHA from source definition
		if (typeof entry.source === "object" && "sha" in entry.source && entry.source.sha) {
			return entry.source.sha.slice(0, 7);
		}

		return "0.0.0";
	}

	async uninstallPlugin(pluginId: string, scope?: "user" | "project" | "local"): Promise<void> {
		const parsed = parsePluginId(pluginId);
		if (!parsed) {
			throw new Error(`Invalid plugin ID format: "${pluginId}". Expected "name@marketplace".`);
		}

		const { userEntries, projectEntries, userReg, projectReg } = await this.#findInBothRegistries(pluginId);

		const inUser = userEntries && userEntries.length > 0;
		const inProject = projectEntries && projectEntries.length > 0;

		if (!inUser && !inProject) {
			throw new Error(`Plugin "${pluginId}" is not installed`);
		}

		// Disambiguation: if installed in both scopes and no explicit scope, require one.
		let targetScope: "user" | "project" | "local";
		if (inUser && inProject) {
			if (!scope) {
				throw new Error(
					`Plugin "${pluginId}" is installed in both user and project scope. Use --scope user or --scope project to specify which to remove.`,
				);
			}
			targetScope = scope;
		} else if (inProject) {
			if (scope === "user") {
				throw new Error(`Plugin "${pluginId}" is not installed in user scope`);
			}
			targetScope = "project";
		} else {
			if (scope === "project") {
				throw new Error(`Plugin "${pluginId}" is not installed in project scope`);
			}
			targetScope = "user";
		}

		const targetEntries = targetScope === "project" ? projectEntries! : userEntries!;
		const targetReg = targetScope === "project" ? projectReg : userReg;
		const registryPath = this.#registryPath(targetScope);
		await this.#assertNoInstalledDependents(pluginId, targetReg);

		const updatedReg = removeInstalledPlugin(targetReg, pluginId);
		await writeInstalledPluginsRegistry(registryPath, updatedReg);

		// Read both registries AFTER removal — only delete paths no longer referenced by either.
		const [freshUserReg, freshProjectReg] = await Promise.all([
			readInstalledPluginsRegistry(this.#opts.installedRegistryPath),
			this.#opts.projectInstalledRegistryPath
				? readInstalledPluginsRegistry(this.#opts.projectInstalledRegistryPath)
				: Promise.resolve({
						version: 2 as const,
						plugins: {} as Record<string, InstalledPluginEntry[]>,
					}),
		]);
		const referenced = collectReferencedPaths(freshUserReg, freshProjectReg);

		for (const entry of targetEntries) {
			if (!referenced.has(entry.installPath)) {
				await fs.rm(entry.installPath, { recursive: true, force: true });
			}
		}

		this.#clearCache();

		logger.debug("Plugin uninstalled", { pluginId, scope: targetScope });
	}

	// ── Plugin state ──────────────────────────────────────────────────────────

	async listInstalledPlugins(): Promise<InstalledPluginSummary[]> {
		const marketplaceReg = await this.#readMarketplacesRegistry();
		const marketplaces = new Map(marketplaceReg.marketplaces.map(entry => [entry.name, entry]));
		const userReg = await readInstalledPluginsRegistry(this.#opts.installedRegistryPath);
		const projectReg = this.#opts.projectInstalledRegistryPath
			? await readInstalledPluginsRegistry(this.#opts.projectInstalledRegistryPath)
			: null;

		// Only enabled project installs shadow user installs — a disabled project copy leaves
		// the user entry as the active one and must not be reported as shadowed.
		const activeProjectIds = new Set(
			projectReg
				? Object.entries(projectReg.plugins)
						.filter(([id, entries]) => {
							const parsed = parsePluginId(id);
							return (
								entries.length > 0 &&
								isInstalledPluginEffectivelyEnabled(
									entries[0],
									parsed ? marketplaces.get(parsed.marketplace) : undefined,
								)
							);
						})
						.map(([id]) => id)
				: [],
		);
		const results: InstalledPluginSummary[] = [];

		// Project entries first
		if (projectReg) {
			for (const [id, entries] of Object.entries(projectReg.plugins)) {
				const parsed = parsePluginId(id);
				results.push({
					id,
					scope: "project",
					entries,
					effectiveEnabled: entries.some(entry =>
						isInstalledPluginEffectivelyEnabled(entry, parsed ? marketplaces.get(parsed.marketplace) : undefined),
					),
				});
			}
		}
		// User entries (shadow-marked if overridden by project)
		for (const [id, entries] of Object.entries(userReg.plugins)) {
			const parsed = parsePluginId(id);
			results.push({
				id,
				scope: "user",
				entries,
				effectiveEnabled: entries.some(entry =>
					isInstalledPluginEffectivelyEnabled(entry, parsed ? marketplaces.get(parsed.marketplace) : undefined),
				),
				...(activeProjectIds.has(id) ? { shadowedBy: "project" as const } : {}),
			});
		}
		return results;
	}

	async setPluginEnabled(pluginId: string, enabled: boolean, scope?: "user" | "project" | "local"): Promise<void> {
		const { userEntries, projectEntries, userReg, projectReg } = await this.#findInBothRegistries(pluginId);

		const inUser = userEntries && userEntries.length > 0;
		const inProject = projectEntries && projectEntries.length > 0;

		if (!inUser && !inProject) {
			throw new Error(`Plugin "${pluginId}" is not installed`);
		}

		// Disambiguation: if installed in both scopes and no explicit scope, require one.
		let targetScope: "user" | "project" | "local";
		if (inUser && inProject) {
			if (!scope) {
				throw new Error(
					`Plugin "${pluginId}" is installed in both user and project scope. Use --scope user or --scope project to specify which to modify.`,
				);
			}
			targetScope = scope;
		} else if (inProject) {
			if (scope === "user") {
				throw new Error(`Plugin "${pluginId}" is not installed in user scope`);
			}
			targetScope = "project";
		} else {
			if (scope === "project") {
				throw new Error(`Plugin "${pluginId}" is not installed in project scope`);
			}
			targetScope = "user";
		}

		const reg = targetScope === "project" ? projectReg : userReg;
		const entries = targetScope === "project" ? projectEntries! : userEntries!;
		const registryPath = this.#registryPath(targetScope);
		if (!enabled) await this.#assertNoInstalledDependents(pluginId, reg);

		const updated = {
			...reg,
			plugins: {
				...reg.plugins,
				[pluginId]: entries.map(e => ({
					...e,
					enabled,
					...(enabled ? { enabledAt: new Date().toISOString() } : {}),
				})),
			},
		};
		await writeInstalledPluginsRegistry(registryPath, updated);

		this.#clearCache();

		logger.debug("Plugin enabled state changed", {
			pluginId,
			enabled,
			scope: targetScope,
		});
	}

	// ── Update / upgrade ─────────────────────────────────────────────────────

	// Refresh marketplace catalogs that haven't been updated in more than 24 h.
	// Per-marketplace failures are silently swallowed — offline is fine.
	async refreshStaleMarketplaces(): Promise<void> {
		const reg = await this.#readMarketplacesRegistry();
		const staleMs = 24 * 60 * 60 * 1000;
		for (const entry of reg.marketplaces) {
			if (!entry.enabled) continue;
			if (Date.now() - Date.parse(entry.updatedAt) >= staleMs) {
				try {
					await this.updateMarketplace(entry.name);
				} catch {
					// Network or parse failure — leave stale, try next time.
				}
			}
		}
	}

	// Compare installed plugin versions against their catalog entries.
	// Returns one entry per (pluginId, scope) pair where the catalog declares a newer version.
	// Catalog entries without a version field are skipped.
	async checkForUpdates(opts?: { refresh?: boolean }): Promise<PluginUpdate[]> {
		// Explicit upgrade flows pass refresh:true to re-fetch catalogs from source before
		// comparing, so freshly-published versions are seen. Passive callers (startup notify,
		// dashboard poll) omit it and rely on the 24h TTL (refreshStaleMarketplaces).
		if (opts?.refresh) await this.refreshMarketplaces();
		const mktReg = await this.#readMarketplacesRegistry();
		return this.#collectUpdates(mktReg);
	}

	/**
	 * Fetch current catalogs into a disposable directory and compare them with installed state.
	 * No registry, persistent cache, installed plugin, or timestamp is changed.
	 */
	async previewPluginUpdates(): Promise<PluginUpdate[]> {
		const mktReg = await this.#readMarketplacesRegistry();
		const previewDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-plugin-upgrade-preview-"));
		try {
			const catalogs = new Map<string, MarketplaceCatalog>();
			for (const marketplace of mktReg.marketplaces) {
				if (!marketplace.enabled) continue;
				const { catalog } = await fetchMarketplace(marketplace.sourceUri, previewDir);
				if (catalog.name !== marketplace.name) {
					throw new Error(
						`Marketplace catalog name changed from "${marketplace.name}" to "${catalog.name}". ` +
							"Remove and re-add the marketplace to update.",
					);
				}
				catalogs.set(marketplace.name, catalog);
			}
			return await this.#collectUpdates(mktReg, catalogs);
		} finally {
			await fs.rm(previewDir, { recursive: true, force: true });
		}
	}

	async #collectUpdates(
		mktReg: { marketplaces: MarketplaceRegistryEntry[] },
		catalogs?: ReadonlyMap<string, MarketplaceCatalog>,
	): Promise<PluginUpdate[]> {
		const updates: PluginUpdate[] = [];

		// Keyed by (path, scope) so each scope is checked independently.
		// A plugin current in user scope but stale in project scope must still appear.
		const registryEntries: Array<[string, "user" | "project" | "local"]> = [
			[this.#opts.installedRegistryPath, "user"],
		];
		if (this.#opts.projectInstalledRegistryPath) {
			registryEntries.push([this.#opts.projectInstalledRegistryPath, "project"]);
		}
		if (this.#opts.localInstalledRegistryPath) {
			registryEntries.push([this.#opts.localInstalledRegistryPath, "local"]);
		}

		for (const [regPath, scope] of registryEntries) {
			const instReg = await readInstalledPluginsRegistry(regPath);
			for (const [pluginId, entries] of Object.entries(instReg.plugins)) {
				const parsed = parsePluginId(pluginId);
				if (!parsed) continue;
				const installed = entries[0];
				if (!installed) continue;

				const mktEntry = mktReg.marketplaces.find(m => m.name === parsed.marketplace);
				if (!mktEntry?.enabled) continue;

				let catalogVersion: string | undefined;
				if (catalogs) {
					catalogVersion = catalogs.get(mktEntry.name)?.plugins.find(p => p.name === parsed.name)?.version;
				} else {
					try {
						const catalog = await this.#readCatalog(mktEntry);
						catalogVersion = catalog.plugins.find(p => p.name === parsed.name)?.version;
					} catch {
						continue;
					}
				}

				if (!catalogVersion || catalogVersion === installed.version) continue;

				// Treat newer semver as an update; fall back to inequality for non-semver tags.
				let isNewer: boolean;
				try {
					isNewer = Bun.semver.order(catalogVersion, installed.version) > 0;
				} catch {
					isNewer = catalogVersion !== installed.version;
				}

				if (isNewer) {
					updates.push({
						pluginId,
						scope,
						from: installed.version,
						to: catalogVersion,
					});
				}
			}
		}

		return updates;
	}

	// Re-install a specific plugin at the latest catalog version (force-overwrites).
	async upgradePlugin(
		pluginId: string,
		scope?: "user" | "project" | "local",
		opts?: { refresh?: boolean },
	): Promise<InstalledPluginEntry> {
		if (opts?.refresh) await this.refreshMarketplaces();
		const parsed = parsePluginId(pluginId);
		if (!parsed) {
			throw new Error(`Invalid plugin ID: "${pluginId}". Expected "name@marketplace".`);
		}

		const { userEntries, projectEntries } = await this.#findInBothRegistries(pluginId);

		const inUser = userEntries && userEntries.length > 0;
		const inProject = projectEntries && projectEntries.length > 0;

		if (!inUser && !inProject) {
			throw new Error(`Plugin "${pluginId}" is not installed`);
		}

		let resolvedScope: "user" | "project" | "local";
		if (inUser && inProject) {
			if (!scope) {
				throw new Error(
					`Plugin "${pluginId}" is installed in both user and project scope. Use --scope user or --scope project to specify which to upgrade.`,
				);
			}
			resolvedScope = scope;
		} else if (inProject) {
			if (scope === "user") throw new Error(`Plugin "${pluginId}" is not installed in user scope`);
			resolvedScope = "project";
		} else {
			if (scope === "project") throw new Error(`Plugin "${pluginId}" is not installed in project scope`);
			resolvedScope = "user";
		}

		return this.installPlugin(parsed.name, parsed.marketplace, {
			force: true,
			scope: resolvedScope,
		});
	}

	// Upgrade a plugin across all scopes where it is installed.
	// Returns one entry per scope upgraded (0–2 entries).
	async upgradePluginAcrossScopes(pluginId: string, opts?: { refresh?: boolean }): Promise<InstalledPluginEntry[]> {
		if (opts?.refresh) await this.refreshMarketplaces();
		const parsed = parsePluginId(pluginId);
		if (!parsed) {
			throw new Error(`Invalid plugin ID: "${pluginId}". Expected "name@marketplace".`);
		}

		const { userEntries, projectEntries } = await this.#findInBothRegistries(pluginId);

		const inUser = userEntries && userEntries.length > 0;
		const inProject = projectEntries && projectEntries.length > 0;

		if (!inUser && !inProject) {
			throw new Error(`Plugin "${pluginId}" is not installed`);
		}

		const results: InstalledPluginEntry[] = [];

		if (inProject) {
			const entry = await this.installPlugin(parsed.name, parsed.marketplace, {
				force: true,
				scope: "project",
			});
			results.push(entry);
		}
		if (inUser) {
			const entry = await this.installPlugin(parsed.name, parsed.marketplace, {
				force: true,
				scope: "user",
			});
			results.push(entry);
		}

		return results;
	}

	// Upgrade every (pluginId, scope) pair that checkForUpdates reports as outdated.
	// Only stale scopes are touched; a current user install is not re-installed when only
	// the project scope is stale. Per-entry failures are skipped — partial success is returned.
	async upgradeAllPlugins(opts?: { refresh?: boolean }): Promise<PluginUpdate[]> {
		const updates = await this.checkForUpdates(opts);
		const results: PluginUpdate[] = [];
		for (const update of updates) {
			try {
				const entry = await this.upgradePlugin(update.pluginId, update.scope);
				results.push({
					pluginId: update.pluginId,
					scope: update.scope,
					from: update.from,
					to: entry.version,
				});
			} catch {
				// Skip this entry; partial upgrades are better than none.
			}
		}
		return results;
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	#registryPath(scope: "user" | "project" | "local"): string {
		if (scope === "project") {
			if (!this.#opts.projectInstalledRegistryPath) {
				throw new Error("project-scoped install requires running inside a project directory");
			}
			return this.#opts.projectInstalledRegistryPath;
		}
		if (scope === "local") {
			if (!this.#opts.localInstalledRegistryPath) {
				throw new Error("local-scoped install requires running inside a project directory");
			}
			return this.#opts.localInstalledRegistryPath;
		}
		return this.#opts.installedRegistryPath;
	}

	async #assertNoInstalledDependents(pluginId: string, registry: InstalledPluginsRegistry): Promise<void> {
		const target = parsePluginId(pluginId);
		if (!target) return;
		const marketplaces = await this.#readMarketplacesRegistry();
		const marketplace = getMarketplaceEntry(marketplaces, target.marketplace);
		if (!marketplace) return;
		const catalog = await this.#readCatalog(marketplace);
		for (const plugin of catalog.plugins) {
			if (!plugin.lifecycle.pluginDependencies.includes(target.name)) continue;
			const dependentId = buildPluginId(plugin.name, target.marketplace);
			if ((registry.plugins[dependentId]?.length ?? 0) > 0) {
				throw new Error(`Plugin "${pluginId}" is required by installed plugin "${dependentId}"`);
			}
		}
	}

	async #findInBothRegistries(pluginId: string): Promise<{
		userEntries: InstalledPluginEntry[] | undefined;
		projectEntries: InstalledPluginEntry[] | undefined;
		userReg: InstalledPluginsRegistry;
		projectReg: InstalledPluginsRegistry;
	}> {
		const [userReg, projectReg] = await Promise.all([
			readInstalledPluginsRegistry(this.#opts.installedRegistryPath),
			this.#opts.projectInstalledRegistryPath
				? readInstalledPluginsRegistry(this.#opts.projectInstalledRegistryPath)
				: Promise.resolve({
						version: 2 as const,
						plugins: {} as Record<string, InstalledPluginEntry[]>,
					}),
		]);
		return {
			userEntries: getInstalledPlugin(userReg, pluginId),
			projectEntries: getInstalledPlugin(projectReg, pluginId),
			userReg,
			projectReg,
		};
	}

	async #readCatalog(entry: MarketplaceRegistryEntry): Promise<MarketplaceCatalog> {
		try {
			const content = await Bun.file(entry.catalogPath).text();
			return parseMarketplaceCatalog(content, entry.catalogPath);
		} catch (err) {
			if (isEnoent(err)) {
				throw new Error(
					`Marketplace catalog not found at ${entry.catalogPath}. Try: /plugin marketplace update ${entry.name}`,
				);
			}
			throw err;
		}
	}

	/**
	 * Compute the marketplace root directory for source resolution.
	 *
	 * For local sources: sourceUri IS the local path, so resolve it directly.
	 * This gives the directory containing `.xcsh-plugin/marketplace.json`,
	 * which is what resolvePluginSource expects as `marketplaceClonePath`.
	 *
	 * For remote sources (git/github/url): the catalog was cloned into
	 * `<marketplacesCacheDir>/<name>/`, so the root is the parent of catalogPath.
	 */
	#resolveMarketplaceRoot(entry: MarketplaceRegistryEntry): string {
		if (entry.sourceType === "local") {
			// expandHome already happened in fetcher; resolve to ensure absolute.
			const expanded = entry.sourceUri.startsWith("~/")
				? path.join(os.homedir(), entry.sourceUri.slice(2))
				: entry.sourceUri;
			return path.resolve(expanded);
		}
		// For git/github/url sources, the catalog lives at <cloneDir>/marketplace.json
		// under marketplacesCacheDir/<name>/; parent = <marketplacesCacheDir>/<name>/
		return path.dirname(entry.catalogPath);
	}
}
