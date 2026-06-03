import type { PluginManager } from "../../../extensibility/plugins/manager";
import type { MarketplaceManager } from "../../../extensibility/plugins/marketplace";
import type { InstalledPluginSummary, MarketplacePluginEntry } from "../../../extensibility/plugins/marketplace/types";
import type { DashboardPlugin, PluginDashboardState, PluginTab, PluginTabId } from "./types";

function npmToDashboard(npm: { name: string; version: string; enabled: boolean }): DashboardPlugin {
	return {
		id: `npm:${npm.name}`,
		name: npm.name,
		source: "npm",
		version: npm.version,
		installed: true,
		enabled: npm.enabled !== false,
		hasUpdate: false,
	};
}

function installedToDashboard(summary: InstalledPluginSummary, updateMap: Map<string, string>): DashboardPlugin {
	const entry = summary.entries[0];
	const atIdx = summary.id.lastIndexOf("@");
	const name = atIdx > 0 ? summary.id.slice(0, atIdx) : summary.id;
	const marketplace = atIdx > 0 ? summary.id.slice(atIdx + 1) : undefined;
	const updateVersion = updateMap.get(`${summary.id}:${summary.scope}`);

	return {
		id: summary.id,
		name,
		marketplace,
		source: "marketplace",
		scope: summary.scope,
		version: entry?.version,
		installed: true,
		enabled: entry?.enabled !== false,
		shadowedBy: summary.shadowedBy,
		hasUpdate: !!updateVersion,
		updateVersion,
	};
}

function catalogToDashboard(entry: MarketplacePluginEntry, marketplace: string): DashboardPlugin {
	return {
		id: `${entry.name}@${marketplace}`,
		name: entry.name,
		marketplace,
		source: "marketplace",
		version: entry.version,
		catalogVersion: entry.version,
		description: entry.description,
		category: entry.category,
		tags: entry.tags,
		author: entry.author?.name,
		homepage: entry.homepage,
		license: entry.license,
		installed: false,
		enabled: false,
		hasUpdate: false,
	};
}

export async function loadAllPlugins(mgr: MarketplaceManager, npmMgr: PluginManager): Promise<DashboardPlugin[]> {
	const [npmPlugins, installedSummaries, updates] = await Promise.all([
		npmMgr.list().catch(() => []),
		mgr.listInstalledPlugins().catch(() => []),
		mgr.checkForUpdates().catch(() => []),
	]);

	const updateMap = new Map<string, string>();
	for (const u of updates) {
		updateMap.set(`${u.pluginId}:${u.scope}`, u.to);
	}

	const plugins: DashboardPlugin[] = [];

	for (const p of npmPlugins) {
		plugins.push(npmToDashboard(p));
	}

	const installedIds = new Set<string>();
	for (const s of installedSummaries) {
		installedIds.add(s.id);
		plugins.push(installedToDashboard(s, updateMap));
	}

	const marketplaces = await mgr.listMarketplaces().catch(() => []);
	for (const mkt of marketplaces) {
		const available = await mgr.listAvailablePlugins(mkt.name).catch(() => []);
		for (const entry of available) {
			const pluginId = `${entry.name}@${mkt.name}`;
			if (installedIds.has(pluginId)) {
				const existing = plugins.find(p => p.id === pluginId);
				if (existing) {
					existing.description = existing.description || entry.description;
					existing.category = existing.category || entry.category;
					existing.tags = existing.tags || entry.tags;
					existing.author = existing.author || entry.author?.name;
					existing.homepage = existing.homepage || entry.homepage;
					existing.license = existing.license || entry.license;
					existing.catalogVersion = entry.version;
				}
				continue;
			}
			plugins.push(catalogToDashboard(entry, mkt.name));
		}
	}

	plugins.sort((a, b) => {
		if (a.installed !== b.installed) return a.installed ? -1 : 1;
		if (a.installed && b.installed) {
			if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});

	return plugins;
}

export function buildTabs(plugins: DashboardPlugin[]): PluginTab[] {
	const tabs: PluginTab[] = [];
	const installedCount = plugins.filter(p => p.installed).length;
	const availableCount = plugins.filter(p => !p.installed).length;
	const updatesCount = plugins.filter(p => p.hasUpdate).length;

	tabs.push({ id: "installed", label: "Installed", count: installedCount });
	if (availableCount > 0) {
		tabs.push({ id: "available", label: "Available", count: availableCount });
	}
	if (updatesCount > 0) {
		tabs.push({ id: "updates", label: "Updates", count: updatesCount });
	}
	return tabs;
}

export function filterByTab(plugins: DashboardPlugin[], tabId: PluginTabId): DashboardPlugin[] {
	switch (tabId) {
		case "installed":
			return plugins.filter(p => p.installed);
		case "available":
			return plugins.filter(p => !p.installed);
		case "updates":
			return plugins.filter(p => p.hasUpdate);
		default:
			return plugins;
	}
}

export function applySearch(plugins: DashboardPlugin[], query: string): DashboardPlugin[] {
	if (!query) return plugins;
	const q = query.toLowerCase();
	return plugins.filter(p => {
		if (p.name.toLowerCase().includes(q)) return true;
		if (p.description?.toLowerCase().includes(q)) return true;
		if (p.marketplace?.toLowerCase().includes(q)) return true;
		if (p.category?.toLowerCase().includes(q)) return true;
		if (p.tags?.some(t => t.toLowerCase().includes(q))) return true;
		if (p.author?.toLowerCase().includes(q)) return true;
		return false;
	});
}

export async function createInitialState(
	mgr: MarketplaceManager,
	npmMgr: PluginManager,
): Promise<PluginDashboardState> {
	const allPlugins = await loadAllPlugins(mgr, npmMgr);
	const tabs = buildTabs(allPlugins);
	const activeTab = tabs[0] ?? { id: "installed" as const, label: "Installed", count: 0 };
	const tabFiltered = filterByTab(allPlugins, activeTab.id);

	return {
		tabs,
		activeTabIndex: 0,
		allPlugins,
		tabFiltered,
		searchFiltered: tabFiltered,
		searchQuery: "",
		selectedIndex: 0,
		scrollOffset: 0,
		notice: null,
		loading: false,
		loadError: null,
	};
}

export async function refreshState(
	state: PluginDashboardState,
	mgr: MarketplaceManager,
	npmMgr: PluginManager,
): Promise<PluginDashboardState> {
	const allPlugins = await loadAllPlugins(mgr, npmMgr);
	const tabs = buildTabs(allPlugins);
	const prevTabId = state.tabs[state.activeTabIndex]?.id ?? "installed";
	const nextTabIndex = Math.max(
		0,
		tabs.findIndex(t => t.id === prevTabId),
	);
	const activeTab = tabs[nextTabIndex] ?? tabs[0];
	const tabFiltered = filterByTab(allPlugins, activeTab?.id ?? "installed");
	const searchFiltered = applySearch(tabFiltered, state.searchQuery);

	return {
		...state,
		tabs,
		activeTabIndex: nextTabIndex,
		allPlugins,
		tabFiltered,
		searchFiltered,
		notice: state.notice,
		loading: false,
		loadError: null,
	};
}
