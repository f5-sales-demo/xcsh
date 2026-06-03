import * as os from "node:os";
import * as path from "node:path";
import {
	type Component,
	Container,
	matchesKey,
	padding,
	replaceTabs,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@f5xc-salesdemos/pi-tui";
import { getConfigDirName } from "@f5xc-salesdemos/pi-utils";
import { invalidate as invalidateFsCache } from "../../../capability/fs";
import { clearXcshPluginRootsCache, resolveActiveProjectRegistryPath } from "../../../discovery/helpers";
import { PluginManager } from "../../../extensibility/plugins";
import {
	getInstalledPluginsRegistryPath,
	getMarketplacesCacheDir,
	getMarketplacesRegistryPath,
	getPluginsCacheDir,
	MarketplaceManager,
} from "../../../extensibility/plugins/marketplace";
import { theme } from "../../theme/theme";
import { matchesAppInterrupt } from "../../utils/keybinding-matchers";
import { DynamicBorder } from "../dynamic-border";
import { PluginInspectorPane } from "./plugin-inspector-pane";
import { PluginListPane } from "./plugin-list-pane";
import { applySearch, buildTabs, createInitialState, filterByTab, loadAllPlugins } from "./state-manager";
import type { DashboardPlugin, PluginDashboardState, PluginTabId } from "./types";

const DEFAULT_MARKETPLACE = "f5xc-salesdemos/marketplace";

class TwoColumnBody implements Component {
	constructor(
		private readonly leftPane: PluginListPane,
		private readonly rightPane: PluginInspectorPane,
		private readonly maxHeight: number,
	) {}

	render(width: number): string[] {
		const leftWidth = Math.floor(width * 0.5);
		const rightWidth = width - leftWidth - 3;
		const leftLines = this.leftPane.render(leftWidth);
		const rightLines = this.rightPane.render(rightWidth);
		const lineCount = Math.min(this.maxHeight, Math.max(leftLines.length, rightLines.length));
		const out: string[] = [];
		const separator = theme.fg("dim", ` ${theme.boxSharp.vertical} `);

		for (let i = 0; i < lineCount; i++) {
			const left = truncateToWidth(leftLines[i] ?? "", leftWidth);
			const leftPadded = left + padding(Math.max(0, leftWidth - visibleWidth(left)));
			const right = truncateToWidth(rightLines[i] ?? "", rightWidth);
			out.push(leftPadded + separator + right);
		}

		return out;
	}

	invalidate(): void {
		this.leftPane.invalidate?.();
		this.rightPane.invalidate?.();
	}
}

export class PluginDashboard extends Container {
	#state!: PluginDashboardState;
	#mgr!: MarketplaceManager;
	#npmMgr!: PluginManager;

	onClose?: () => void;
	onRequestRender?: () => void;

	private constructor(
		private readonly cwd: string,
		private readonly terminalHeight: number,
	) {
		super();
	}

	static async create(cwd: string, terminalHeight?: number): Promise<PluginDashboard> {
		const dashboard = new PluginDashboard(cwd, terminalHeight ?? process.stdout.rows ?? 24);
		await dashboard.#init();
		return dashboard;
	}

	async #init(): Promise<void> {
		const projectRegistryPath = (await resolveActiveProjectRegistryPath(this.cwd)) ?? undefined;

		this.#mgr = new MarketplaceManager({
			marketplacesRegistryPath: getMarketplacesRegistryPath(),
			installedRegistryPath: getInstalledPluginsRegistryPath(),
			projectInstalledRegistryPath: projectRegistryPath,
			marketplacesCacheDir: getMarketplacesCacheDir(),
			pluginsCacheDir: getPluginsCacheDir(),
			clearPluginRootsCache: (extraPaths?: readonly string[]) => {
				const home = os.homedir();
				invalidateFsCache(path.join(home, getConfigDirName(), "plugins", "installed_plugins.json"));
				for (const p of extraPaths ?? []) invalidateFsCache(p);
				clearXcshPluginRootsCache();
			},
		});

		this.#npmMgr = new PluginManager();

		try {
			const marketplaces = await this.#mgr.listMarketplaces();
			if (marketplaces.length === 0) {
				await this.#mgr.addMarketplace(DEFAULT_MARKETPLACE);
			}
		} catch {
			// Network failure on first run is fine — continue with whatever is available
		}

		try {
			this.#state = await createInitialState(this.#mgr, this.#npmMgr);
		} catch (error) {
			this.#state = {
				tabs: [{ id: "installed", label: "Installed", count: 0 }],
				activeTabIndex: 0,
				allPlugins: [],
				tabFiltered: [],
				searchFiltered: [],
				searchQuery: "",
				selectedIndex: 0,
				scrollOffset: 0,
				notice: null,
				loading: false,
				loadError: error instanceof Error ? error.message : String(error),
			};
		}

		this.#buildLayout();
	}

	#selectedPlugin(): DashboardPlugin | null {
		return this.#state.searchFiltered[this.#state.selectedIndex] ?? null;
	}

	#activeTabId(): PluginTabId {
		return this.#state.tabs[this.#state.activeTabIndex]?.id ?? "installed";
	}

	#getMaxVisibleItems(): number {
		return Math.max(5, this.terminalHeight - 14);
	}

	#applyFilters(): void {
		this.#state.tabFiltered = filterByTab(this.#state.allPlugins, this.#activeTabId());
		this.#state.searchFiltered = applySearch(this.#state.tabFiltered, this.#state.searchQuery);
		this.#clampSelection();
	}

	#clampSelection(): void {
		const len = this.#state.searchFiltered.length;
		if (len === 0) {
			this.#state.selectedIndex = 0;
			this.#state.scrollOffset = 0;
			return;
		}

		this.#state.selectedIndex = Math.min(this.#state.selectedIndex, len - 1);
		this.#state.selectedIndex = Math.max(0, this.#state.selectedIndex);

		const maxVisible = this.#getMaxVisibleItems();
		if (this.#state.selectedIndex < this.#state.scrollOffset) {
			this.#state.scrollOffset = this.#state.selectedIndex;
		} else if (this.#state.selectedIndex >= this.#state.scrollOffset + maxVisible) {
			this.#state.scrollOffset = this.#state.selectedIndex - maxVisible + 1;
		}
	}

	#switchTab(direction: 1 | -1): void {
		if (this.#state.tabs.length === 0) return;
		this.#state.activeTabIndex =
			(this.#state.activeTabIndex + direction + this.#state.tabs.length) % this.#state.tabs.length;
		this.#state.selectedIndex = 0;
		this.#state.scrollOffset = 0;
		this.#applyFilters();
		this.#buildLayout();
	}

	#moveSelection(delta: -1 | 1): void {
		if (this.#state.searchFiltered.length === 0) return;
		this.#state.selectedIndex = Math.max(
			0,
			Math.min(this.#state.searchFiltered.length - 1, this.#state.selectedIndex + delta),
		);
		this.#clampSelection();
		this.#buildLayout();
	}

	async #reloadData(): Promise<void> {
		this.#state.loading = true;
		this.#state.loadError = null;
		this.#buildLayout();

		try {
			const selectedId = this.#selectedPlugin()?.id;
			const allPlugins = await loadAllPlugins(this.#mgr, this.#npmMgr);
			const tabs = buildTabs(allPlugins);
			const prevTabId = this.#activeTabId();
			const nextTabIndex = Math.max(
				0,
				tabs.findIndex(t => t.id === prevTabId),
			);

			this.#state.allPlugins = allPlugins;
			this.#state.tabs = tabs;
			this.#state.activeTabIndex = nextTabIndex;
			this.#applyFilters();

			if (selectedId) {
				const idx = this.#state.searchFiltered.findIndex(p => p.id === selectedId);
				if (idx >= 0) this.#state.selectedIndex = idx;
			}
			this.#clampSelection();
		} catch (error) {
			this.#state.loadError = error instanceof Error ? error.message : String(error);
		} finally {
			this.#state.loading = false;
			this.#rebuildAndRender();
		}
	}

	async #toggleEnabled(): Promise<void> {
		const plugin = this.#selectedPlugin();
		if (!plugin?.installed) return;

		try {
			if (plugin.source === "marketplace") {
				await this.#mgr.setPluginEnabled(plugin.id, !plugin.enabled, plugin.scope);
			}
			plugin.enabled = !plugin.enabled;
			this.#state.notice = `${plugin.enabled ? "Enabled" : "Disabled"} ${plugin.name}`;
		} catch (error) {
			this.#state.notice = `Toggle failed: ${error instanceof Error ? error.message : String(error)}`;
		}
		this.#rebuildAndRender();
	}

	async #handleEnterAction(): Promise<void> {
		const plugin = this.#selectedPlugin();
		if (!plugin) return;
		const tabId = this.#activeTabId();

		if (tabId === "available" && !plugin.installed) {
			await this.#installPlugin(plugin);
		} else if (tabId === "updates" && plugin.hasUpdate) {
			await this.#upgradePlugin(plugin);
		} else if (tabId === "installed" && plugin.installed && plugin.source === "marketplace") {
			await this.#uninstallPlugin(plugin);
		}
	}

	async #installPlugin(plugin: DashboardPlugin): Promise<void> {
		if (!plugin.marketplace) return;
		this.#state.notice = `Installing ${plugin.name}...`;
		this.#rebuildAndRender();

		try {
			await this.#mgr.installPlugin(plugin.name, plugin.marketplace);
			this.#state.notice = `Installed ${plugin.name}`;
			await this.#reloadData();
		} catch (error) {
			this.#state.notice = `Install failed: ${error instanceof Error ? error.message : String(error)}`;
			this.#rebuildAndRender();
		}
	}

	async #uninstallPlugin(plugin: DashboardPlugin): Promise<void> {
		this.#state.notice = `Uninstalling ${plugin.name}...`;
		this.#rebuildAndRender();

		try {
			await this.#mgr.uninstallPlugin(plugin.id, plugin.scope);
			this.#state.notice = `Uninstalled ${plugin.name}`;
			await this.#reloadData();
		} catch (error) {
			this.#state.notice = `Uninstall failed: ${error instanceof Error ? error.message : String(error)}`;
			this.#rebuildAndRender();
		}
	}

	async #upgradePlugin(plugin: DashboardPlugin): Promise<void> {
		this.#state.notice = `Upgrading ${plugin.name}...`;
		this.#rebuildAndRender();

		try {
			await this.#mgr.upgradePlugin(plugin.id, plugin.scope);
			this.#state.notice = `Upgraded ${plugin.name}`;
			await this.#reloadData();
		} catch (error) {
			this.#state.notice = `Upgrade failed: ${error instanceof Error ? error.message : String(error)}`;
			this.#rebuildAndRender();
		}
	}

	#renderTabBar(): string {
		const parts: string[] = [" "];
		for (let i = 0; i < this.#state.tabs.length; i++) {
			const tab = this.#state.tabs[i];
			const label = `${tab.label} (${tab.count})`;
			if (i === this.#state.activeTabIndex) {
				parts.push(theme.bg("selectedBg", ` ${label} `));
			} else {
				parts.push(theme.fg("muted", ` ${label} `));
			}
		}
		return parts.join("");
	}

	#getHelpText(): string {
		const tabId = this.#activeTabId();
		switch (tabId) {
			case "available":
				return " ↑/↓: navigate  Enter: install  Tab: next tab  Ctrl+R: reload  Esc: close";
			case "updates":
				return " ↑/↓: navigate  Enter: upgrade  Tab: next tab  Ctrl+R: reload  Esc: close";
			default:
				return " ↑/↓: navigate  Space: toggle  Enter: uninstall  U: upgrade  Tab: next tab  Ctrl+R: reload  Esc: close";
		}
	}

	#rebuildAndRender(): void {
		this.#buildLayout();
		this.onRequestRender?.();
	}

	#buildLayout(): void {
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.bold(theme.fg("contentAccent", " xcsh Plugin Center")), 0, 0));
		this.addChild(new Text(this.#renderTabBar(), 0, 0));
		this.addChild(new Spacer(1));

		if (this.#state.notice) {
			this.addChild(new Text(theme.fg("success", replaceTabs(this.#state.notice)), 0, 0));
			this.addChild(new Spacer(1));
		}

		if (this.#state.loading) {
			this.addChild(new Text(theme.fg("muted", "Loading plugins..."), 0, 0));
			this.addChild(new Spacer(1));
		} else if (this.#state.loadError) {
			this.addChild(
				new Text(theme.fg("error", `Failed to load plugins: ${replaceTabs(this.#state.loadError)}`), 0, 0),
			);
			this.addChild(new Spacer(1));
		} else {
			const selected = this.#selectedPlugin();
			const listPane = new PluginListPane(
				this.#state.searchFiltered,
				this.#state.selectedIndex,
				this.#state.scrollOffset,
				this.#state.searchQuery,
				this.#getMaxVisibleItems(),
				this.#activeTabId(),
			);
			const inspector = new PluginInspectorPane(selected);
			const bodyHeight = Math.max(5, this.terminalHeight - 8);
			this.addChild(new TwoColumnBody(listPane, inspector, bodyHeight));
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("dim", this.#getHelpText()), 0, 0));
		}

		this.addChild(new DynamicBorder());
	}

	handleInput(data: string): void {
		if (matchesKey(data, "ctrl+c")) {
			this.onClose?.();
			return;
		}

		if (matchesAppInterrupt(data)) {
			if (this.#state.searchQuery) {
				this.#state.searchQuery = "";
				this.#applyFilters();
				this.#buildLayout();
			} else {
				this.onClose?.();
			}
			return;
		}

		if (matchesKey(data, "tab")) {
			this.#switchTab(1);
			return;
		}

		if (matchesKey(data, "shift+tab")) {
			this.#switchTab(-1);
			return;
		}

		if (matchesKey(data, "up") || data === "k") {
			this.#moveSelection(-1);
			return;
		}

		if (matchesKey(data, "down") || data === "j") {
			this.#moveSelection(1);
			return;
		}

		if (matchesKey(data, "space")) {
			void this.#toggleEnabled();
			return;
		}

		if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n") {
			void this.#handleEnterAction();
			return;
		}

		if (data.toLowerCase() === "u") {
			const plugin = this.#selectedPlugin();
			if (plugin?.hasUpdate) {
				void this.#upgradePlugin(plugin);
			}
			return;
		}

		if (matchesKey(data, "ctrl+r")) {
			void this.#reloadData();
			return;
		}

		if (matchesKey(data, "backspace") || matchesKey(data, "delete") || data === "\x7f") {
			if (this.#state.searchQuery.length > 0) {
				this.#state.searchQuery = this.#state.searchQuery.slice(0, -1);
				this.#state.notice = null;
				this.#applyFilters();
				this.#buildLayout();
			}
			return;
		}

		if (data.length === 1 && data >= " " && data <= "~" && data !== "j" && data !== "k" && data !== "u") {
			this.#state.searchQuery += data;
			this.#state.notice = null;
			this.#applyFilters();
			this.#buildLayout();
			return;
		}
	}
}
