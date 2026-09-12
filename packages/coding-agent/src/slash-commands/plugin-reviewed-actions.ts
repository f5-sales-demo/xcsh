import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
	InstalledPluginSummary,
	MarketplaceManager,
	MarketplacePluginEntry,
	MarketplaceRegistryEntry,
	PluginUpdate,
} from "../extensibility/plugins/marketplace";
import { fetchMarketplace } from "../extensibility/plugins/marketplace";
import { setupTool } from "../extensibility/plugins/marketplace/prerequisites";
import type { ActionReview } from "../modes/components/reviewed-action";
import { StaleActionReviewError } from "../modes/components/reviewed-action";

export type PluginScope = "user" | "project";

interface InstalledTarget {
	summary: InstalledPluginSummary;
	entry: InstalledPluginSummary["entries"][number];
}

export interface PreparedPluginInstall {
	review: ActionReview;
	target: {
		name: string;
		marketplace: string;
		scope: PluginScope;
		force: boolean;
		catalogRevision: string;
	};
	warnings: string[];
}

export interface PreparedInstalledPluginAction {
	review: ActionReview;
	target: {
		pluginId: string;
		scope: PluginScope;
		version: string;
		enabled: boolean;
	};
}

export interface PreparedPluginUpgrade extends PreparedInstalledPluginAction {
	target: PreparedInstalledPluginAction["target"] & { to: string };
}

export interface PreparedPluginUpgradeAll {
	review: ActionReview;
	target: { updates: PluginUpdate[] };
}

export interface PreparedMarketplaceAddition {
	review: ActionReview;
	target: { source: string; name: string; catalogRevision: string };
}

export interface PreparedMarketplaceRemoval {
	review: ActionReview;
	target: MarketplaceRegistryEntry;
}

export interface PreparedPluginSetup {
	review: ActionReview;
	target: {
		items: Array<{
			name: string;
			displayName: string;
			marketplace: string;
			catalogRevision: string;
			plugin: MarketplacePluginEntry;
		}>;
	};
	warnings: string[];
}

export interface PluginSetupResult {
	installed: string[];
	failed: Array<{ pluginId: string; error: string }>;
	authenticationNeeded: string[];
}

function pluginCatalogRevision(plugin: MarketplacePluginEntry): string {
	return JSON.stringify(plugin);
}

function installedRevision(target: InstalledTarget): string {
	return JSON.stringify({
		id: target.summary.id,
		scope: target.summary.scope,
		entries: target.summary.entries.map(entry => ({
			version: entry.version,
			enabled: entry.enabled !== false,
			installPath: entry.installPath,
			installedAt: entry.installedAt,
			lastUpdated: entry.lastUpdated,
		})),
		shadowedBy: target.summary.shadowedBy ?? null,
	});
}

function sortUpdates(updates: readonly PluginUpdate[]): PluginUpdate[] {
	return [...updates].sort((a, b) =>
		`${a.pluginId}\0${a.scope}\0${a.from}\0${a.to}`.localeCompare(`${b.pluginId}\0${b.scope}\0${b.from}\0${b.to}`),
	);
}

function isNewerVersion(candidate: string, installed: string): boolean {
	try {
		return Bun.semver.order(candidate, installed) > 0;
	} catch {
		return candidate !== installed;
	}
}

async function installedTarget(
	manager: MarketplaceManager,
	pluginId: string,
	requestedScope?: PluginScope,
): Promise<InstalledTarget> {
	const candidates = (await manager.listInstalledPlugins()).filter(summary => summary.id === pluginId);
	if (!candidates.length) throw new Error(`Plugin "${pluginId}" is not installed.`);
	let summary: InstalledPluginSummary | undefined;
	if (requestedScope) {
		summary = candidates.find(candidate => candidate.scope === requestedScope);
		if (!summary) throw new Error(`Plugin "${pluginId}" is not installed in ${requestedScope} scope.`);
	} else if (candidates.length > 1) {
		throw new Error(`Plugin "${pluginId}" is installed in multiple scopes. Use --scope user or --scope project.`);
	} else summary = candidates[0];
	if (summary.scope !== "user" && summary.scope !== "project")
		throw new Error(`Plugin "${pluginId}" uses unsupported ${summary.scope} scope in the terminal manager.`);
	const entry = summary.entries[0];
	if (!entry) throw new Error(`Plugin "${pluginId}" has no installed entry in ${summary.scope} scope.`);
	return { summary, entry };
}

export async function preparePluginInstall(
	manager: MarketplaceManager,
	name: string,
	marketplace: string,
	scope: PluginScope,
	force: boolean,
): Promise<PreparedPluginInstall> {
	const preview = await manager.previewMarketplacePlugins([marketplace]);
	const catalog = preview.plugins.find(item => item.marketplace === marketplace && item.plugin.name === name)?.plugin;
	if (!catalog)
		throw new Error(
			preview.failed.includes(marketplace)
				? `Marketplace "${marketplace}" is unavailable and has no cached entry for "${name}".`
				: `Plugin "${name}" was not found in marketplace "${marketplace}".`,
		);
	const pluginId = `${name}@${marketplace}`;
	const existing = (await manager.listInstalledPlugins()).find(
		summary => summary.id === pluginId && summary.scope === scope,
	);
	if (existing && !force)
		throw new Error(
			`Plugin "${pluginId}" is already installed in ${scope} scope. Use --force to review a reinstall.`,
		);
	const oldEntry = existing?.entries[0];
	const version = catalog.version ?? "resolved manifest version";
	const enabledAfter = oldEntry
		? oldEntry.enabled === false
			? "Disabled (preserved)"
			: "Enabled (preserved)"
		: catalog.defaultEnabled === false
			? "Disabled"
			: "Enabled";
	const catalogRevision = pluginCatalogRevision(catalog);
	return {
		review: {
			identity: `plugin:${pluginId}:${scope}`,
			scope: `${scope} plugin registry`,
			revision: JSON.stringify({
				catalogRevision,
				installed: existing ? installedRevision({ summary: existing, entry: oldEntry! }) : null,
			}),
			changes: [
				{
					field: "Installed version",
					before: oldEntry?.version ?? "Not installed",
					after: version,
				},
				{
					field: "Enabled state",
					before: oldEntry?.enabled === false ? "Disabled" : oldEntry ? "Enabled" : "Absent",
					after: enabledAfter,
				},
				{ field: "Destination", before: oldEntry ? `${scope} scope` : "Absent", after: `${scope} scope` },
			],
			consequence: `${force ? "Reinstalls" : "Installs"} this exact catalog entry and writes the ${scope} registry. ${
				catalog.prerequisites?.length
					? `Declared prerequisites: ${catalog.prerequisites.map(item => `${item.tool} (${item.installCmd})`).join(", ")}.`
					: "No prerequisites are declared."
			} ${preview.failed.length ? `The preview used last-known data for ${preview.failed.join(", ")}; confirmation will require a fresh catalog.` : "The catalog preview is current."} --force controls replacement only; this review is still required.`,
		},
		target: { name, marketplace, scope, force, catalogRevision },
		warnings: preview.failed.map(source => `Using last-known catalog data for ${source}.`),
	};
}

export async function executePluginInstall(
	manager: MarketplaceManager,
	target: PreparedPluginInstall["target"],
): Promise<void> {
	const refresh = await manager.refreshMarketplaces([target.marketplace]);
	if (refresh.failed.includes(target.marketplace))
		throw new Error(`Marketplace "${target.marketplace}" could not be refreshed; installation was not started.`);
	const catalog = await manager.getPluginInfo(target.name, target.marketplace);
	if (!catalog || pluginCatalogRevision(catalog) !== target.catalogRevision) throw new StaleActionReviewError();
	await manager.installPlugin(target.name, target.marketplace, { force: target.force, scope: target.scope });
}

export async function preparePluginEnabled(
	manager: MarketplaceManager,
	pluginId: string,
	requestedScope: PluginScope | undefined,
	enabled: boolean,
): Promise<PreparedInstalledPluginAction | null> {
	const installed = await installedTarget(manager, pluginId, requestedScope);
	const current = installed.entry.enabled !== false;
	if (current === enabled) return null;
	const scope = installed.summary.scope as PluginScope;
	return {
		review: {
			identity: `plugin:${pluginId}:${scope}`,
			scope: `${scope} plugin registry`,
			revision: installedRevision(installed),
			changes: [
				{
					field: "Enabled state",
					before: current ? "Enabled" : "Disabled",
					after: enabled ? "Enabled" : "Disabled",
				},
			],
			consequence: "Writes only this scoped installation. Running plugin processes may require a restart.",
		},
		target: { pluginId, scope, version: installed.entry.version, enabled: current },
	};
}

export async function preparePluginRemoval(
	manager: MarketplaceManager,
	pluginId: string,
	requestedScope?: PluginScope,
): Promise<PreparedInstalledPluginAction> {
	const installed = await installedTarget(manager, pluginId, requestedScope);
	const scope = installed.summary.scope as PluginScope;
	return {
		review: {
			identity: `plugin:${pluginId}:${scope}`,
			scope: `${scope} plugin registry and unreferenced cache`,
			revision: installedRevision(installed),
			changes: [
				{ field: "Installed version", before: installed.entry.version, after: "Removed" },
				{
					field: "Enabled state",
					before: installed.entry.enabled === false ? "Disabled" : "Enabled",
					after: "Absent",
				},
			],
			consequence:
				"Removes only this scoped registry entry and deletes cache paths no longer referenced by another scope. Other scoped copies remain installed.",
		},
		target: {
			pluginId,
			scope,
			version: installed.entry.version,
			enabled: installed.entry.enabled !== false,
		},
	};
}

export async function preparePluginUpgrade(
	manager: MarketplaceManager,
	pluginId: string,
	requestedScope?: PluginScope,
): Promise<PreparedPluginUpgrade | null> {
	const installed = await installedTarget(manager, pluginId, requestedScope);
	const scope = installed.summary.scope as PluginScope;
	const separator = pluginId.lastIndexOf("@");
	const name = pluginId.slice(0, separator);
	const marketplace = pluginId.slice(separator + 1);
	const preview = await manager.previewMarketplacePlugins([marketplace]);
	const catalogVersion = preview.plugins.find(
		candidate => candidate.marketplace === marketplace && candidate.plugin.name === name,
	)?.plugin.version;
	if (preview.failed.includes(marketplace) && !catalogVersion)
		throw new Error(`Marketplace "${marketplace}" is unavailable; upgrade status could not be determined.`);
	if (
		preview.failed.includes(marketplace) &&
		catalogVersion &&
		!isNewerVersion(catalogVersion, installed.entry.version)
	)
		throw new Error(
			`Marketplace "${marketplace}" is unavailable; the cached catalog cannot prove this plugin is current.`,
		);
	if (!catalogVersion || !isNewerVersion(catalogVersion, installed.entry.version)) return null;
	const update: PluginUpdate = {
		pluginId,
		scope,
		from: installed.entry.version,
		to: catalogVersion,
	};
	return {
		review: {
			identity: `plugin:${pluginId}:${scope}`,
			scope: `${scope} plugin registry and versioned cache`,
			revision: JSON.stringify({ installed: installedRevision(installed), update }),
			changes: [{ field: "Installed version", before: update.from, after: update.to }],
			consequence: `Refreshes the source catalog, installs the reviewed version, preserves the enabled state, and removes unreferenced old cache data. ${
				preview.failed.length
					? `The preview used last-known data for ${preview.failed.join(", ")}; confirmation will require a fresh catalog.`
					: "The catalog preview is current."
			}`,
		},
		target: {
			pluginId,
			scope,
			version: installed.entry.version,
			enabled: installed.entry.enabled !== false,
			to: update.to,
		},
	};
}

export async function executePluginUpgrade(
	manager: MarketplaceManager,
	target: PreparedPluginUpgrade["target"],
): Promise<void> {
	const marketplace = target.pluginId.slice(target.pluginId.lastIndexOf("@") + 1);
	const refresh = await manager.refreshMarketplaces([marketplace]);
	if (refresh.failed.includes(marketplace))
		throw new Error(`Marketplace "${marketplace}" could not be refreshed; upgrade was not started.`);
	const update = (await manager.checkForUpdates()).find(
		candidate => candidate.pluginId === target.pluginId && candidate.scope === target.scope,
	);
	if (!update || update.from !== target.version || update.to !== target.to) throw new StaleActionReviewError();
	await manager.upgradePlugin(target.pluginId, target.scope);
}

export async function preparePluginUpgradeAll(manager: MarketplaceManager): Promise<PreparedPluginUpgradeAll | null> {
	const preview = await manager.previewMarketplacePlugins();
	const versions = new Map<string, string>(
		preview.plugins
			.filter(item => item.plugin.version)
			.map(item => [`${item.plugin.name}@${item.marketplace}`, item.plugin.version!] as const),
	);
	const updates = sortUpdates(
		(await manager.listInstalledPlugins()).flatMap(summary => {
			if (summary.scope !== "user" && summary.scope !== "project") return [];
			const installed = summary.entries[0];
			const candidate = versions.get(summary.id);
			if (!installed || !candidate || !isNewerVersion(candidate, installed.version)) return [];
			return [{ pluginId: summary.id, scope: summary.scope, from: installed.version, to: candidate }];
		}),
	);
	if (!updates.length && preview.failed.length)
		throw new Error(
			`Could not determine plugin updates because these marketplaces are unavailable: ${preview.failed.join(", ")}.`,
		);
	if (!updates.length) return null;
	return {
		review: {
			identity: "plugins:all-outdated-scopes",
			scope: "All configured user and project plugin registries",
			revision: JSON.stringify(updates),
			changes: updates.map(update => ({
				field: `${update.pluginId} (${update.scope})`,
				before: update.from,
				after: update.to,
			})),
			consequence: `Refreshes every source catalog and upgrades only the reviewed outdated scope entries. ${
				preview.failed.length
					? `The preview used last-known data for ${preview.failed.join(", ")}; entries whose source still cannot refresh remain unresolved while other reviewed entries may proceed.`
					: "All catalog previews are current."
			} Re-run the command to review and retry unresolved failures.`,
		},
		target: { updates },
	};
}

export async function preparePluginSetup(manager: MarketplaceManager): Promise<PreparedPluginSetup | null> {
	const preview = await manager.previewMarketplacePlugins();
	const installedIds = new Set((await manager.listInstalledPlugins()).map(summary => summary.id));
	const items = preview.plugins
		.filter(item => item.plugin.recommended && !installedIds.has(`${item.plugin.name}@${item.marketplace}`))
		.map(item => ({
			name: item.plugin.name,
			displayName: item.plugin.displayName || item.plugin.name,
			marketplace: item.marketplace,
			catalogRevision: pluginCatalogRevision(item.plugin),
			plugin: item.plugin,
		}))
		.sort((a, b) => `${a.name}\0${a.marketplace}`.localeCompare(`${b.name}\0${b.marketplace}`));
	if (!items.length && preview.failed.length)
		throw new Error(
			`Could not determine recommended setup because these marketplaces are unavailable: ${preview.failed.join(", ")}.`,
		);
	if (!items.length) return null;
	return {
		review: {
			identity: `plugins:recommended:${items.map(item => `${item.name}@${item.marketplace}`).join(",")}`,
			scope: "User plugin registry, versioned cache, and declared prerequisite tools",
			revision: JSON.stringify(
				items.map(item => ({ id: `${item.name}@${item.marketplace}`, catalog: item.catalogRevision })),
			),
			changes: items.map(item => ({
				field: `${item.name}@${item.marketplace}`,
				before: "Not installed",
				after: `${item.plugin.version ?? "resolved manifest version"} (user scope)`,
			})),
			consequence: `Installs ${items.length} recommended plugin(s). ${
				items
					.flatMap(item => item.plugin.prerequisites ?? [])
					.map(
						prerequisite =>
							`${prerequisite.tool}: ${prerequisite.installCmd}${prerequisite.authLoginCmd ? `; sign in: ${prerequisite.authLoginCmd}` : ""}`,
					)
					.join(" · ") || "No prerequisites are declared."
			} ${preview.failed.length ? `The preview used last-known data for ${preview.failed.join(", ")}; confirmation will require a fresh catalog.` : "All catalog previews are current."} Failures are isolated; re-run setup to review only unresolved plugins.`,
		},
		target: { items },
		warnings: preview.failed.map(source => `Using last-known catalog data for ${source}.`),
	};
}

export async function executePluginSetup(
	manager: MarketplaceManager,
	target: PreparedPluginSetup["target"],
): Promise<PluginSetupResult> {
	const marketplaces = [...new Set(target.items.map(item => item.marketplace))];
	const refresh = await manager.refreshMarketplaces(marketplaces);
	for (const item of target.items.filter(candidate => !refresh.failed.includes(candidate.marketplace))) {
		const current = await manager.getPluginInfo(item.name, item.marketplace);
		if (!current || pluginCatalogRevision(current) !== item.catalogRevision) throw new StaleActionReviewError();
	}
	const installed: string[] = [];
	const failed: Array<{ pluginId: string; error: string }> = target.items
		.filter(item => refresh.failed.includes(item.marketplace))
		.map(item => ({ pluginId: `${item.name}@${item.marketplace}`, error: "marketplace refresh failed" }));
	const authenticationNeeded: string[] = [];
	for (const item of target.items) {
		const pluginId = `${item.name}@${item.marketplace}`;
		if (refresh.failed.includes(item.marketplace)) continue;
		let ready = true;
		for (const prerequisite of item.plugin.prerequisites ?? []) {
			const result = await setupTool(prerequisite);
			if (result.installAttempted && !result.installSuccess) {
				ready = false;
				failed.push({ pluginId, error: `${prerequisite.tool}: ${result.error ?? "installation failed"}` });
				break;
			}
			if (!result.authenticated && prerequisite.authLoginCmd)
				authenticationNeeded.push(`${prerequisite.tool}: ${prerequisite.authLoginCmd}`);
		}
		if (!ready) continue;
		try {
			await manager.installPlugin(item.name, item.marketplace, { scope: "user" });
			installed.push(pluginId);
		} catch (error) {
			failed.push({ pluginId, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { installed, failed, authenticationNeeded };
}

export async function executePluginUpgradeAll(
	manager: MarketplaceManager,
	target: PreparedPluginUpgradeAll["target"],
): Promise<{ completed: PluginUpdate[]; failed: Array<PluginUpdate & { error: string }> }> {
	const marketplaces = [
		...new Set(target.updates.map(update => update.pluginId.slice(update.pluginId.lastIndexOf("@") + 1))),
	];
	const refresh = await manager.refreshMarketplaces(marketplaces);
	const current = sortUpdates(await manager.checkForUpdates());
	const currentByTarget = new Map(current.map(update => [`${update.pluginId}\0${update.scope}`, update]));
	for (const update of target.updates) {
		const marketplace = update.pluginId.slice(update.pluginId.lastIndexOf("@") + 1);
		if (refresh.failed.includes(marketplace)) continue;
		const resolved = currentByTarget.get(`${update.pluginId}\0${update.scope}`);
		if (!resolved || resolved.from !== update.from || resolved.to !== update.to) throw new StaleActionReviewError();
	}
	const completed: PluginUpdate[] = [];
	const failed: Array<PluginUpdate & { error: string }> = [];
	for (const update of target.updates) {
		const marketplace = update.pluginId.slice(update.pluginId.lastIndexOf("@") + 1);
		if (refresh.failed.includes(marketplace)) {
			failed.push({ ...update, error: "marketplace refresh failed" });
			continue;
		}
		try {
			await manager.upgradePlugin(update.pluginId, update.scope);
			completed.push(update);
		} catch (error) {
			failed.push({ ...update, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { completed, failed };
}

async function inspectMarketplaceSource(source: string): Promise<{ name: string; revision: string }> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-marketplace-review-"));
	try {
		const fetched = await fetchMarketplace(source, directory);
		return { name: fetched.catalog.name, revision: JSON.stringify(fetched.catalog) };
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}

export async function prepareMarketplaceAddition(
	manager: MarketplaceManager,
	source: string,
): Promise<PreparedMarketplaceAddition> {
	const catalog = await inspectMarketplaceSource(source);
	const existing = (await manager.listMarketplaces()).find(marketplace => marketplace.name === catalog.name);
	if (existing) throw new Error(`Marketplace "${catalog.name}" is already configured.`);
	return {
		review: {
			identity: `marketplace:${catalog.name}`,
			scope: "User marketplace registry and catalog cache",
			revision: JSON.stringify({ source, catalog: catalog.revision }),
			changes: [
				{ field: "Marketplace", before: "Not configured", after: catalog.name },
				{ field: "Source", before: "Absent", after: source },
			],
			consequence: "Fetches and caches this catalog and adds its source to the user marketplace registry.",
		},
		target: { source, name: catalog.name, catalogRevision: catalog.revision },
	};
}

export async function executeMarketplaceAddition(
	manager: MarketplaceManager,
	target: PreparedMarketplaceAddition["target"],
): Promise<void> {
	await manager.addMarketplace(target.source, catalog => {
		if (catalog.name !== target.name || JSON.stringify(catalog) !== target.catalogRevision)
			throw new StaleActionReviewError();
	});
}

export async function prepareMarketplaceRemoval(
	manager: MarketplaceManager,
	name: string,
): Promise<PreparedMarketplaceRemoval> {
	const marketplace = (await manager.listMarketplaces()).find(candidate => candidate.name === name);
	if (!marketplace) throw new Error(`Marketplace "${name}" is not configured.`);
	const installed = (await manager.listInstalledPlugins()).filter(summary => summary.id.endsWith(`@${name}`));
	return {
		review: {
			identity: `marketplace:${name}`,
			scope: "User marketplace registry and catalog cache",
			revision: JSON.stringify(marketplace),
			changes: [
				{ field: "Marketplace", before: name, after: "Removed" },
				{ field: "Source", before: marketplace.sourceUri, after: "Not configured" },
			],
			consequence: `Removes the saved source and cached catalog. ${
				installed.length
					? `${installed.length} installed scoped copy/copies remain installed but cannot receive marketplace updates.`
					: "No installed plugins currently depend on this marketplace."
			}`,
		},
		target: marketplace,
	};
}
