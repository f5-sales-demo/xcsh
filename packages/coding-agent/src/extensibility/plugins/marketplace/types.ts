/**
 * Marketplace plugin system types.
 *
 * Two registries:
 *   - MarketplacesRegistry: which marketplace catalogs the user has added (config)
 *   - InstalledPluginsRegistry: which plugins are installed (data)
 *
 * The installed registry MUST pass `parseXcshPluginsRegistry()` validation —
 * it uses `version: 2` (numeric) and `plugins: Record<string, ...[]>`.
 */

// ── Plugin ID helpers ────────────────────────────────────────────────

const NAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const MAX_NAME_LENGTH = 64;
const MAX_ID_LENGTH = 128;

/** Validate a plugin or marketplace name segment. */
export function isValidNameSegment(s: string): boolean {
	return s.length > 0 && s.length <= MAX_NAME_LENGTH && NAME_RE.test(s);
}

/** Build canonical plugin ID: `"name@marketplace"`. Both segments are validated. */
export function buildPluginId(name: string, marketplace: string): string {
	if (!isValidNameSegment(name)) {
		throw new Error(`Invalid plugin name: "${name}"`);
	}
	if (!isValidNameSegment(marketplace)) {
		throw new Error(`Invalid marketplace name: "${marketplace}"`);
	}
	const id = `${name}@${marketplace}`;
	if (id.length > MAX_ID_LENGTH) {
		throw new Error(`Plugin ID exceeds ${MAX_ID_LENGTH} characters: "${id}"`);
	}
	return id;
}

/** Parse `"name@marketplace"` → `{ name, marketplace }` or `null`. */
export function parsePluginId(id: string): { name: string; marketplace: string } | null {
	const atIndex = id.lastIndexOf("@");
	if (atIndex <= 0 || atIndex === id.length - 1) return null;

	const name = id.slice(0, atIndex);
	const marketplace = id.slice(atIndex + 1);

	if (!isValidNameSegment(name) || !isValidNameSegment(marketplace)) return null;

	return { name, marketplace };
}

// ── Marketplace catalog (from marketplace.json in a marketplace repo) ─

export interface MarketplaceCatalogOwner {
	name: string;
	email?: string;
}

export interface MarketplaceCatalogMetadata {
	description?: string;
	version?: string;
	/** If set, prepended to relative plugin source paths. */
	pluginRoot?: string;
}

export interface MarketplaceCatalog {
	name: string;
	owner: MarketplaceCatalogOwner;
	metadata?: MarketplaceCatalogMetadata;
	plugins: MarketplacePluginEntry[];
}

export interface MarketplacePluginAuthor {
	name: string;
	email?: string;
}

export type PluginLifecycleMode = "content" | "on_demand" | "integrated";

export interface MarketplacePluginLifecycle {
	mode: PluginLifecycleMode;
	integrations: string[];
	requirements: string[];
	setupRequired: boolean;
	collectedData: string[];
	pluginDependencies: string[];
}

export interface MarketplacePluginEntry {
	name: string;
	displayName?: string;
	source: PluginSource;
	description?: string;
	version?: string;
	author?: MarketplacePluginAuthor;
	homepage?: string;
	repository?: string;
	license?: string;
	keywords?: string[];
	category?: string;
	tags?: string[];
	strict?: boolean;
	defaultEnabled?: boolean;
	recommended?: boolean;
	lifecycle: MarketplacePluginLifecycle;
	commands?: string | string[];
	agents?: string | string[];
	hooks?: string | Record<string, unknown>;
	mcpServers?: string | Record<string, unknown>;
	lspServers?: string | Record<string, unknown>;
}

// ── Plugin source variants ───────────────────────────────────────────

export type PluginSource =
	| string // relative path "./plugins/foo"
	| PluginSourceGitHub
	| PluginSourceUrl
	| PluginSourceGitSubdir
	| PluginSourceNpm;

export interface PluginSourceGitHub {
	source: "github";
	repo: string;
	ref?: string;
	sha?: string;
}

export interface PluginSourceUrl {
	source: "url";
	url: string;
	ref?: string;
	sha?: string;
}

export interface PluginSourceGitSubdir {
	source: "git-subdir";
	url: string;
	path: string;
	ref?: string;
	sha?: string;
}

export interface PluginSourceNpm {
	source: "npm";
	package: string;
	version?: string;
	registry?: string;
}

// ── Marketplaces registry (stored in <configRoot>/marketplaces.json) ─

export interface MarketplacesRegistry {
	version: 2;
	marketplaces: MarketplaceRegistryEntry[];
}

export type MarketplaceSourceType = "github" | "git" | "url" | "local";

export interface MarketplaceRegistryEntry {
	name: string;
	sourceType: MarketplaceSourceType;
	sourceUri: string;
	catalogPath: string;
	addedAt: string;
	updatedAt: string;
	/** Whether discovery and lifecycle operations are allowed for this marketplace. */
	enabled: boolean;
	/** Built-in entries are reconciled by xcsh and cannot be removed. */
	builtIn: boolean;
	/** Most recent marketplace disable time. Used to keep older installs inactive after re-enable. */
	pluginsDisabledAt?: string;
}

// ── Installed plugins registry ───────────────────────────────────────
// MUST match XcshPluginsRegistry shape for parseXcshPluginsRegistry()
// compatibility: `version: number`, `plugins: Record<string, entry[]>`.

export interface InstalledPluginsRegistry {
	/** MUST be 2 — parseXcshPluginsRegistry rejects non-numeric version. */
	version: 2;
	plugins: Record<string, InstalledPluginEntry[]>;
}

export interface InstalledPluginEntry {
	scope: "user" | "project" | "local";
	/** Absolute path to cached plugin directory. */
	installPath: string;
	version: string;
	/** ISO 8601 date string. */
	installedAt: string;
	/** ISO 8601 date string. */
	lastUpdated: string;
	/** For git-sourced plugins. */
	gitCommitSha?: string;
	/** OMP extension — CLI/UI concern only in v1. */
	enabled?: boolean;
	/** Most recent explicit plugin enable time. */
	enabledAt?: string;
}

/**
 * A merged view of an installed plugin, combining entries from both the user and
 * project registries. Returned by MarketplaceManager.listInstalledPlugins().
 *
 * `shadowedBy` is set on user-scoped summaries when the same plugin ID also exists
 * in the project registry — the project entry takes precedence for capability loading.
 */
export interface InstalledPluginSummary {
	id: string;
	scope: "user" | "project" | "local";
	entries: InstalledPluginEntry[];
	/** Effective state after applying both plugin and marketplace enablement. */
	effectiveEnabled?: boolean;
	/** Set when a user-scoped plugin is overridden by a project-scoped install. */
	shadowedBy?: "project";
}

export function isInstalledPluginEffectivelyEnabled(
	entry: Pick<InstalledPluginEntry, "enabled" | "enabledAt" | "installedAt">,
	marketplace?: Pick<MarketplaceRegistryEntry, "enabled" | "pluginsDisabledAt">,
): boolean {
	if (entry.enabled === false || marketplace?.enabled === false) return false;
	if (!marketplace?.pluginsDisabledAt) return true;
	const disabledAt = Date.parse(marketplace.pluginsDisabledAt);
	if (!Number.isFinite(disabledAt)) return true;
	const installedAt = Date.parse(entry.installedAt);
	const explicitlyEnabledAt = entry.enabledAt ? Date.parse(entry.enabledAt) : Number.NEGATIVE_INFINITY;
	return installedAt > disabledAt || explicitlyEnabledAt > disabledAt;
}
