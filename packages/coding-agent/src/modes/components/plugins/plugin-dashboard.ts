import * as os from "node:os";
import * as path from "node:path";
import { Container, Input, matchesKey, replaceTabs, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { getConfigDirName } from "@f5-sales-demo/pi-utils";
import { invalidate as invalidateFsCache } from "../../../capability/fs";
import { clearXcshPluginRootsCache, resolveActiveProjectRegistryPath } from "../../../discovery/helpers";
import { PluginManager } from "../../../extensibility/plugins";
import {
	formatMarketplaceRefreshWarning,
	getInstalledPluginsRegistryPath,
	getMarketplacesCacheDir,
	getMarketplacesRegistryPath,
	getPluginsCacheDir,
	MarketplaceManager,
} from "../../../extensibility/plugins/marketplace";
import { setupTool } from "../../../extensibility/plugins/marketplace/prerequisites";
import { theme } from "../../theme/theme";
import { type ActionReview, executeReviewedAction, StaleActionReviewError } from "../reviewed-action";
import {
	matchesSelectorKey,
	type SelectorFrameLine,
	selectorFrame,
	selectorFrameContentWidth,
	selectorRow,
} from "../selector-frame";
import { applySearch, buildTabs, filterByTab, loadAllPlugins, pluginSelectionKey } from "./state-manager";
import type {
	DashboardPlugin,
	PluginBulkResult,
	PluginDashboardOperations,
	PluginDashboardState,
	PluginTabId,
} from "./types";

type View =
	| "browse"
	| "details"
	| "install-review"
	| "update-review"
	| "remove-confirm"
	| "bulk-review"
	| "enabled-review";
type FeedbackKind = "progress" | "success" | "warning" | "failure";

interface Feedback {
	kind: FeedbackKind;
	message: string;
}

interface TestOptions {
	rows?: () => number;
	operations?: Partial<PluginDashboardOperations>;
	projectScopeAvailable?: boolean;
}

const EMPTY_OPERATIONS: PluginDashboardOperations = {
	refresh: async () => [],
	load: async () => [],
	install: async () => {},
	remove: async () => {},
	setEnabled: async () => {},
	upgrade: async () => {},
	installRecommended: async plugins => ({
		installed: plugins.length,
		failed: 0,
		total: plugins.length,
		authenticationNeeded: [],
	}),
};

function emptyState(initialTab: PluginTabId): PluginDashboardState {
	const tabs = buildTabs([]);
	return {
		tabs,
		activeTabIndex: tabs.findIndex(tab => tab.id === initialTab),
		allPlugins: [],
		tabFiltered: [],
		searchFiltered: [],
		searchQuery: "",
		selectedIndex: 0,
		scrollOffset: 0,
		notice: null,
		warning: null,
		loading: true,
		loadError: null,
	};
}

function pluginStatus(plugin: DashboardPlugin): string {
	if (!plugin.installed) return plugin.recommended ? "Recommended" : "Available";
	if (plugin.hasUpdate) return plugin.updateVersion ? `Update ${plugin.updateVersion}` : "Update available";
	return plugin.enabled ? "Enabled" : "Disabled";
}

function pluginScope(plugin: DashboardPlugin): string {
	return plugin.scope ?? (plugin.installed ? "user" : "—");
}

function marketplacePluginName(plugin: DashboardPlugin): string {
	const separator = plugin.id.lastIndexOf("@");
	return separator > 0 ? plugin.id.slice(0, separator) : plugin.name;
}

function catalogReviewRevision(plugin: DashboardPlugin): string {
	return JSON.stringify({
		catalogVersion: plugin.catalogVersion ?? plugin.version ?? null,
		prerequisites: plugin.prerequisites ?? [],
	});
}

export class PluginDashboard extends Container {
	#state: PluginDashboardState;
	#operations: PluginDashboardOperations;
	#rows: () => number;
	#searchInput = new Input();
	#view: View = "browse";
	#actionIndex = 0;
	#detailOffset = 0;
	#operationInFlight = false;
	#refreshGeneration = 0;
	#closed = false;
	#feedback?: Feedback;
	#enabledReview?: ActionReview;
	#proposedEnabled = false;
	#projectScopeAvailable: boolean;

	onClose?: () => void;
	onRequestRender?: () => void;

	private constructor(
		state: PluginDashboardState,
		operations: PluginDashboardOperations,
		rows: () => number,
		projectScopeAvailable: boolean,
	) {
		super();
		this.#state = state;
		this.#operations = operations;
		this.#rows = rows;
		this.#searchInput.setValue(state.searchQuery);
		this.#searchInput.setCursorToEnd();
		this.#projectScopeAvailable = projectScopeAvailable;
	}

	static async create(
		cwd: string,
		rows: number | (() => number) = () => process.stdout.rows || 24,
		initialTab: PluginTabId = "installed",
	): Promise<PluginDashboard> {
		const rowProvider = typeof rows === "function" ? rows : () => rows;
		const projectRegistryPath = (await resolveActiveProjectRegistryPath(cwd)) ?? undefined;
		const manager = new MarketplaceManager({
			marketplacesRegistryPath: getMarketplacesRegistryPath(),
			installedRegistryPath: getInstalledPluginsRegistryPath(),
			projectInstalledRegistryPath: projectRegistryPath,
			marketplacesCacheDir: getMarketplacesCacheDir(),
			pluginsCacheDir: getPluginsCacheDir(),
			clearPluginRootsCache: (extraPaths?: readonly string[]) => {
				const home = os.homedir();
				invalidateFsCache(path.join(home, getConfigDirName(), "plugins", "installed_plugins.json"));
				for (const registryPath of extraPaths ?? []) invalidateFsCache(registryPath);
				clearXcshPluginRootsCache();
			},
		});
		const npmManager = new PluginManager(cwd);
		let dashboard!: PluginDashboard;
		const operations = PluginDashboard.#productionOperations(manager, npmManager, warning => {
			if (dashboard) dashboard.#state.warning = warning;
		});
		dashboard = new PluginDashboard(
			emptyState(initialTab),
			operations,
			rowProvider,
			projectRegistryPath !== undefined,
		);
		void dashboard.#initialLoad(manager);
		return dashboard;
	}

	/** Deterministic construction for interaction tests and sanitized capture fixtures. */
	static createForTest(state: PluginDashboardState, options: TestOptions = {}): PluginDashboard {
		return new PluginDashboard(
			{ ...state, tabs: buildTabs(state.allPlugins) },
			{
				...EMPTY_OPERATIONS,
				load: async () => state.allPlugins,
				refresh: async () => state.allPlugins,
				...options.operations,
			},
			options.rows ?? (() => 24),
			options.projectScopeAvailable ?? true,
		);
	}

	static #productionOperations(
		manager: MarketplaceManager,
		npmManager: PluginManager,
		setWarning: (warning: string | null) => void,
	): PluginDashboardOperations {
		const load = () => loadAllPlugins(manager, npmManager);
		return {
			load,
			refresh: async () => {
				try {
					const result = await manager.refreshMarketplaces();
					setWarning(formatMarketplaceRefreshWarning(result) ?? null);
				} catch (error) {
					setWarning(
						`Marketplace refresh failed. Showing last-known data. Retry when connectivity returns: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}
				return load();
			},
			install: async (plugin, scope) => {
				if (!plugin.marketplace) throw new Error("This plugin has no marketplace source.");
				const result = await manager.refreshMarketplaces([plugin.marketplace]);
				setWarning(formatMarketplaceRefreshWarning(result) ?? null);
				if (result.failed.includes(plugin.marketplace))
					throw new Error(
						`Marketplace ${plugin.marketplace} could not be refreshed; installation was not started.`,
					);
				const sourceName = marketplacePluginName(plugin);
				const current = await manager.getPluginInfo(sourceName, plugin.marketplace);
				if (
					!current ||
					JSON.stringify({
						catalogVersion: current.version ?? null,
						prerequisites: current.prerequisites ?? [],
					}) !== catalogReviewRevision(plugin)
				)
					throw new StaleActionReviewError();
				await manager.installPlugin(sourceName, plugin.marketplace, { scope });
			},
			remove: async plugin => {
				if (plugin.source === "npm") await npmManager.uninstall(plugin.id.slice("npm:".length));
				else await manager.uninstallPlugin(plugin.id, plugin.scope);
			},
			setEnabled: async (plugin, enabled) => {
				if (plugin.source === "npm") await npmManager.setEnabled(plugin.id.slice("npm:".length), enabled);
				else await manager.setPluginEnabled(plugin.id, enabled, plugin.scope);
			},
			upgrade: async plugin => {
				if (plugin.source !== "marketplace") throw new Error("Updates for package plugins use the package CLI.");
				const result = await manager.refreshMarketplaces(plugin.marketplace ? [plugin.marketplace] : undefined);
				setWarning(formatMarketplaceRefreshWarning(result) ?? null);
				if (!plugin.marketplace || result.failed.includes(plugin.marketplace))
					throw new Error(
						`Marketplace ${plugin.marketplace ?? "source"} could not be refreshed; upgrade was not started.`,
					);
				const update = (await manager.checkForUpdates()).find(
					candidate => candidate.pluginId === plugin.id && candidate.scope === plugin.scope,
				);
				if (!update || update.from !== plugin.version || update.to !== plugin.updateVersion)
					throw new StaleActionReviewError();
				await manager.upgradePlugin(plugin.id, plugin.scope);
			},
			installRecommended: async plugins => {
				let installed = 0;
				const marketplaces = [
					...new Set(plugins.flatMap(plugin => (plugin.marketplace ? [plugin.marketplace] : []))),
				];
				const refresh = await manager.refreshMarketplaces(marketplaces);
				setWarning(formatMarketplaceRefreshWarning(refresh) ?? null);
				let failed = plugins.filter(
					plugin => !plugin.marketplace || refresh.failed.includes(plugin.marketplace),
				).length;
				const authenticationNeeded: string[] = [];
				for (const plugin of plugins.filter(
					candidate => candidate.marketplace && !refresh.failed.includes(candidate.marketplace),
				)) {
					const current = await manager.getPluginInfo(marketplacePluginName(plugin), plugin.marketplace!);
					if (
						!current ||
						JSON.stringify({
							catalogVersion: current.version ?? null,
							prerequisites: current.prerequisites ?? [],
						}) !== catalogReviewRevision(plugin)
					)
						throw new StaleActionReviewError();
				}
				for (const plugin of plugins) {
					if (!plugin.marketplace || refresh.failed.includes(plugin.marketplace)) continue;
					let ready = true;
					for (const prerequisite of plugin.prerequisites ?? []) {
						const result = await setupTool(prerequisite);
						if (result.installAttempted && !result.installSuccess) ready = false;
						if (!result.authenticated && prerequisite.authLoginCmd)
							authenticationNeeded.push(`${prerequisite.tool}: ${prerequisite.authLoginCmd}`);
					}
					if (!ready) {
						failed++;
						continue;
					}
					try {
						const sourceName = marketplacePluginName(plugin);
						await manager.installPlugin(sourceName, plugin.marketplace, { scope: "user" });
						installed++;
					} catch {
						failed++;
					}
				}
				return { installed, failed, total: plugins.length, authenticationNeeded };
			},
		};
	}

	async #initialLoad(manager: MarketplaceManager): Promise<void> {
		try {
			await manager.listMarketplaces();
			await this.#reload(true);
		} catch (error) {
			try {
				this.#replacePlugins(await this.#operations.load());
			} catch {
				// The actionable refresh error below remains authoritative.
			}
			this.#state.loading = false;
			this.#state.loadError = error instanceof Error ? error.message : String(error);
			this.#state.warning = "Marketplace data is unavailable. Previously loaded plugins remain visible.";
			this.#requestRender();
		}
	}

	#activeTabId(): PluginTabId {
		return this.#state.tabs[this.#state.activeTabIndex]?.id ?? "installed";
	}

	#selectedPlugin(): DashboardPlugin | null {
		return this.#state.searchFiltered[this.#state.selectedIndex] ?? null;
	}

	#hasBulkAction(): boolean {
		return this.#activeTabId() === "recommended" && this.#state.searchFiltered.length > 0 && !this.#state.searchQuery;
	}

	#choiceCount(): number {
		return this.#state.searchFiltered.length + (this.#hasBulkAction() ? 1 : 0);
	}

	#bulkSelected(): boolean {
		return this.#hasBulkAction() && this.#state.selectedIndex === this.#state.searchFiltered.length;
	}

	#applyFilters(selectionKey?: string): void {
		this.#state.searchQuery = this.#searchInput.getValue();
		this.#state.tabFiltered = filterByTab(this.#state.allPlugins, this.#activeTabId());
		this.#state.searchFiltered = applySearch(this.#state.tabFiltered, this.#state.searchQuery);
		if (selectionKey) {
			const index = this.#state.searchFiltered.findIndex(item => pluginSelectionKey(item) === selectionKey);
			if (index >= 0) this.#state.selectedIndex = index;
		}
		this.#clampSelection();
	}

	#replacePlugins(plugins: DashboardPlugin[], selectionKey?: string): void {
		const activeTab = this.#activeTabId();
		this.#state.allPlugins = plugins;
		this.#state.tabs = buildTabs(plugins);
		this.#state.activeTabIndex = Math.max(
			0,
			this.#state.tabs.findIndex(tab => tab.id === activeTab),
		);
		this.#applyFilters(selectionKey);
	}

	#clampSelection(): void {
		const count = this.#choiceCount();
		if (count === 0) {
			this.#state.selectedIndex = 0;
			this.#state.scrollOffset = 0;
			return;
		}
		this.#state.selectedIndex = Math.max(0, Math.min(this.#state.selectedIndex, count - 1));
	}

	#switchTab(delta: -1 | 1): void {
		this.#state.activeTabIndex =
			(this.#state.activeTabIndex + delta + this.#state.tabs.length) % this.#state.tabs.length;
		this.#state.selectedIndex = 0;
		this.#state.scrollOffset = 0;
		this.#feedback = undefined;
		this.#applyFilters();
		this.#requestRender();
	}

	#moveSelection(delta: -1 | 1): void {
		const count = this.#choiceCount();
		if (!count) return;
		this.#state.selectedIndex = (this.#state.selectedIndex + delta + count) % count;
		this.#feedback = undefined;
		this.#requestRender();
	}

	#requestRender(): void {
		this.invalidate();
		if (!this.#closed) this.onRequestRender?.();
	}

	async #reload(remote: boolean): Promise<void> {
		if (this.#operationInFlight) return;
		const generation = ++this.#refreshGeneration;
		const selected = this.#selectedPlugin();
		const selectionKey = selected ? pluginSelectionKey(selected) : undefined;
		this.#state.loading = true;
		this.#state.loadError = null;
		this.#feedback = {
			kind: "progress",
			message: remote ? "Refreshing plugin catalogs…" : "Refreshing plugin state…",
		};
		this.#requestRender();
		try {
			const plugins = await (remote ? this.#operations.refresh() : this.#operations.load());
			if (generation !== this.#refreshGeneration) return;
			this.#replacePlugins(plugins, selectionKey);
			this.#feedback = this.#state.warning
				? { kind: "warning", message: "Some catalog information could not be refreshed. Ctrl+R: retry." }
				: { kind: "success", message: "Plugin information is up to date." };
		} catch (error) {
			if (generation !== this.#refreshGeneration) return;
			this.#state.loadError = error instanceof Error ? error.message : String(error);
			this.#feedback = { kind: "failure", message: `Refresh failed: ${this.#state.loadError}` };
		} finally {
			if (generation === this.#refreshGeneration) {
				this.#state.loading = false;
				this.#requestRender();
			}
		}
	}

	#detailsActions(plugin: DashboardPlugin): string[] {
		if (!plugin.installed) return ["Review installation"];
		return [
			plugin.enabled ? "Disable plugin" : "Enable plugin",
			"Refresh plugin status",
			...(plugin.hasUpdate && plugin.source === "marketplace" ? ["Upgrade plugin"] : []),
			"Remove plugin",
		];
	}

	#openDetails(): void {
		if (this.#bulkSelected()) {
			this.#view = "bulk-review";
			this.#actionIndex = 0;
			return;
		}
		if (!this.#selectedPlugin()) return;
		this.#view = "details";
		this.#actionIndex = 0;
		this.#detailOffset = 0;
		this.#feedback = undefined;
	}

	async #runOperation(label: string, operation: () => Promise<void>, mutate?: () => void): Promise<void> {
		if (this.#operationInFlight) return;
		const target = this.#selectedPlugin();
		const scope =
			label === "Installation"
				? this.#actionIndex === 2
					? "project"
					: "user"
				: target
					? pluginScope(target)
					: "user";
		const identity = target ? `${target.displayName || target.name} · ${scope} scope` : "plugin";
		++this.#refreshGeneration;
		this.#state.loading = false;
		this.#operationInFlight = true;
		this.#feedback = { kind: "progress", message: `${label} in progress… ${identity}` };
		this.#requestRender();
		try {
			await operation();
			mutate?.();
			this.#view = "browse";
			try {
				const plugins = await this.#operations.load();
				let match = plugins.find(
					item =>
						item.source === target?.source &&
						item.id === target?.id &&
						(label === "Removal" ? !item.installed : item.scope === target?.scope),
				);
				if (!match && label === "Removal")
					match = plugins.find(item => item.source === target?.source && item.id === target?.id && item.installed);
				const tab = label === "Removal" && match && !match.installed ? "discover" : "installed";
				this.#state.activeTabIndex = this.#state.tabs.findIndex(item => item.id === tab);
				this.#replacePlugins(plugins, match ? pluginSelectionKey(match) : undefined);
				this.#feedback = {
					kind: "success",
					message: `${label} completed. ${identity}.${match ? ` ${label === "Removal" && match.installed ? "Remaining copy shown" : "Shown"} in ${tab === "installed" ? "Installed" : "Discover"}.` : ""}`,
				};
			} catch {
				this.#feedback = {
					kind: "warning",
					message: `${label} completed. ${identity}. Status refresh failed; Ctrl+R: retry.`,
				};
			}
		} catch (error) {
			if (error instanceof StaleActionReviewError) {
				this.#view = "details";
				this.#actionIndex = 0;
			}
			this.#feedback = {
				kind: "failure",
				message: `${label} failed for ${identity}: ${error instanceof Error ? error.message : String(error)}. Retry the action.`,
			};
		} finally {
			this.#operationInFlight = false;
			this.#requestRender();
		}
	}

	async #runBulkInstall(): Promise<void> {
		if (this.#operationInFlight) return;
		const plugins = this.#state.allPlugins.filter(plugin => plugin.recommended && !plugin.installed);
		const review = this.#reviewBulk(plugins);
		this.#operationInFlight = true;
		this.#feedback = { kind: "progress", message: `Recommended setup in progress for ${plugins.length} plugins…` };
		this.#requestRender();
		try {
			let result!: PluginBulkResult;
			await executeReviewedAction(
				review,
				async () => {
					const current = await this.#operations.load();
					const targets = current.filter(plugin => plugin.recommended && !plugin.installed);
					return targets.length ? { review: this.#reviewBulk(targets), target: targets } : undefined;
				},
				async targets => {
					result = await this.#operations.installRecommended(targets);
				},
			);
			this.#feedback = { kind: result.failed ? "warning" : "success", message: this.#bulkOutcome(result) };
			this.#view = "browse";
			try {
				this.#replacePlugins(await this.#operations.load());
			} catch {
				// Preserve the reported partial outcome if the follow-up read fails.
			}
		} catch (error) {
			this.#feedback = {
				kind: "failure",
				message: `Recommended setup failed: ${error instanceof Error ? error.message : String(error)}. Retry from the review.`,
			};
		} finally {
			this.#operationInFlight = false;
			this.#requestRender();
		}
	}

	#bulkOutcome(result: PluginBulkResult): string {
		const parts = [`Installed ${result.installed} of ${result.total} recommended plugins`];
		if (result.failed) parts.push(`${result.failed} failed`);
		if (result.authenticationNeeded.length)
			parts.push(`Authentication still needed: ${result.authenticationNeeded.join(", ")}`);
		return `${parts.join(". ")}.`;
	}

	#activateDetailAction(): void {
		const plugin = this.#selectedPlugin();
		if (!plugin) return;
		const action = this.#detailsActions(plugin)[this.#actionIndex];
		if (action === "Review installation") {
			this.#view = "install-review";
			this.#actionIndex = 0;
		} else if (action === "Remove plugin") {
			this.#view = "remove-confirm";
			this.#actionIndex = 0;
		} else if (action === "Refresh plugin status") {
			void this.#reload(false);
		} else if (action === "Upgrade plugin") {
			this.#view = "update-review";
			this.#actionIndex = 0;
		} else if (action === "Enable plugin" || action === "Disable plugin") {
			this.#proposedEnabled = action === "Enable plugin";
			this.#enabledReview = this.#reviewEnabled(plugin, this.#proposedEnabled);
			this.#view = "enabled-review";
			this.#actionIndex = 0;
		}
	}

	#reviewEnabled(plugin: DashboardPlugin, enabled: boolean): ActionReview {
		return {
			identity: pluginSelectionKey(plugin),
			scope: pluginScope(plugin),
			revision: plugin.version ?? "unknown",
			changes: [
				{
					field: "Enabled state",
					before: plugin.enabled ? "Enabled" : "Disabled",
					after: enabled ? "Enabled" : "Disabled",
				},
			],
			consequence: "Saves this installation's enabled state. Running plugin processes may require a restart.",
		};
	}

	#reviewInstall(plugin: DashboardPlugin, scope: "user" | "project"): ActionReview {
		return {
			identity: `${pluginSelectionKey(plugin)}\0${scope}`,
			scope: `${scope} plugin registry`,
			revision: catalogReviewRevision(plugin),
			changes: [
				{
					field: "Installed version",
					before: "Not installed",
					after: plugin.catalogVersion ?? plugin.version ?? "resolved manifest version",
				},
				{ field: "Destination", before: "Absent", after: `${scope} scope` },
			],
			consequence: `${
				plugin.prerequisites?.length
					? `Declared prerequisites: ${plugin.prerequisites.map(item => `${item.tool} (${item.installCmd})`).join(", ")}.`
					: "No prerequisites are declared."
			} The selected scoped registry and versioned cache are written only after confirmation.`,
		};
	}

	#reviewUpgrade(plugin: DashboardPlugin): ActionReview {
		return {
			identity: pluginSelectionKey(plugin),
			scope: `${pluginScope(plugin)} plugin registry and versioned cache`,
			revision: JSON.stringify({
				installed: plugin.version ?? null,
				available: plugin.updateVersion ?? null,
				enabled: plugin.enabled,
			}),
			changes: [
				{
					field: "Installed version",
					before: plugin.version ?? "unknown",
					after: plugin.updateVersion ?? "latest",
				},
			],
			consequence: "Updates only this scoped installation and preserves its enabled state.",
		};
	}

	#reviewRemoval(plugin: DashboardPlugin): ActionReview {
		return {
			identity: pluginSelectionKey(plugin),
			scope: `${pluginScope(plugin)} plugin registry and unreferenced cache`,
			revision: JSON.stringify({ version: plugin.version ?? null, enabled: plugin.enabled }),
			changes: [
				{ field: "Installed version", before: plugin.version ?? "unknown", after: "Removed" },
				{ field: "Enabled state", before: plugin.enabled ? "Enabled" : "Disabled", after: "Absent" },
			],
			consequence: "Removes only this scoped copy. Cache data still referenced by another scope is retained.",
		};
	}

	#reviewBulk(plugins: DashboardPlugin[]): ActionReview {
		const targets = plugins
			.map(plugin => ({
				identity: `plugin:${plugin.source}:${plugin.id}:${plugin.scope ?? "catalog"}`,
				version: plugin.catalogVersion ?? plugin.version ?? null,
				prerequisites: plugin.prerequisites ?? [],
			}))
			.sort((a, b) => a.identity.localeCompare(b.identity));
		return {
			identity: `plugins:recommended:${targets.map(target => target.identity).join(",")}`,
			scope: "User plugin registry, versioned cache, and declared prerequisite tools",
			revision: JSON.stringify(targets),
			changes: targets.map(target => ({
				field: target.identity.replaceAll("\0", " · "),
				before: "Not installed",
				after: `${target.version ?? "resolved manifest version"} (user scope)`,
			})),
			consequence: `Installs exactly the reviewed recommended entries. ${
				targets
					.flatMap(target => target.prerequisites)
					.map(prerequisite => `${prerequisite.tool} (${prerequisite.installCmd})`)
					.join(", ") || "No prerequisites are declared."
			} Partial results remain explicit; retry reviews only entries still unresolved.`,
		};
	}

	#metadata(plugin: DashboardPlugin): string[] {
		const prerequisites = plugin.prerequisites ?? [];
		return [
			`Identifier: ${plugin.id}`,
			`Source: ${plugin.source}${plugin.marketplace ? ` · ${plugin.marketplace}` : ""}`,
			`Status: ${plugin.installed ? (plugin.enabled ? "Enabled" : "Disabled") : pluginStatus(plugin)}`,
			`Scope: ${pluginScope(plugin)}`,
			...(plugin.installed && plugin.version ? [`Installed version: ${plugin.version}`] : []),
			...(plugin.catalogVersion ? [`Catalog version: ${plugin.catalogVersion}`] : []),
			...(plugin.updateVersion ? [`Available version: ${plugin.updateVersion}`] : []),
			...(plugin.shadowedBy ? [`Availability: shadowed by ${plugin.shadowedBy} scope`] : []),
			...(plugin.description ? [`Description: ${replaceTabs(plugin.description)}`] : []),
			...(plugin.author ? [`Author: ${replaceTabs(plugin.author)}`] : []),
			...(plugin.license ? [`License: ${replaceTabs(plugin.license)}`] : []),
			...(plugin.homepage ? [`Homepage: ${replaceTabs(plugin.homepage)}`] : []),
			...(plugin.category ? [`Category: ${replaceTabs(plugin.category)}`] : []),
			...(plugin.tags?.length ? [`Tags: ${plugin.tags.map(tag => replaceTabs(tag)).join(", ")}`] : []),
			...(prerequisites.length
				? [
						"Prerequisites:",
						...prerequisites.map(
							item =>
								`${item.tool} · install: ${item.installCmd}${item.authLoginCmd ? ` · sign in: ${item.authLoginCmd}` : ""}`,
						),
					]
				: ["Prerequisites: none declared"]),
		];
	}

	#feedbackLine(): string | undefined {
		if (!this.#feedback) return undefined;
		const color =
			this.#feedback.kind === "success"
				? "success"
				: this.#feedback.kind === "failure"
					? "error"
					: this.#feedback.kind === "warning"
						? "warning"
						: "contentAccent";
		return theme.fg(color, this.#feedback.message);
	}

	#renderTabs(wide: boolean): string[] {
		const labels = this.#state.tabs.map((tab, index) => {
			const label = `${tab.label} (${tab.count})`;
			return index === this.#state.activeTabIndex
				? theme.bg("selectedBg", theme.fg("text", ` ${label} `))
				: theme.fg("muted", ` ${label} `);
		});
		return wide ? [labels.join("  ")] : [labels.slice(0, 2).join("  "), labels.slice(2).join("  ")];
	}

	#emptyMessage(): string {
		if (this.#state.searchQuery)
			return `No plugins match “${this.#state.searchQuery}”. Edit the search or press Esc to clear it.`;
		switch (this.#activeTabId()) {
			case "installed":
				return "No plugins are installed. Open Discover to review available plugins.";
			case "recommended":
				return "No recommended plugins need installation.";
			case "updates":
				return "Installed plugins are up to date.";
			default:
				return "No plugins are available. Add or refresh a marketplace, then retry.";
		}
	}

	#browseBody(inner: number, wide: boolean): { body: SelectorFrameLine[]; selectedBodyIndex?: number } {
		const body: SelectorFrameLine[] = [];
		let selectedBodyIndex: number | undefined;
		if (wide) body.push(selectorRow(["Plugin", "Status", "Scope"], [inner - 33, 18, 9], false, "muted"));
		for (let index = 0; index < this.#state.searchFiltered.length; index++) {
			const plugin = this.#state.searchFiltered[index]!;
			const selected = index === this.#state.selectedIndex;
			if (selected) selectedBodyIndex = body.length;
			body.push(
				selectorRow(
					wide
						? [plugin.displayName || plugin.name, pluginStatus(plugin), pluginScope(plugin)]
						: [plugin.displayName || plugin.name],
					wide ? [inner - 33, 18, 9] : [inner - 2],
					selected,
					plugin.installed && !plugin.enabled ? "muted" : "text",
				),
			);
		}
		if (this.#hasBulkAction()) {
			const selected = this.#bulkSelected();
			if (selected) selectedBodyIndex = body.length;
			body.push(
				selectorRow(
					wide
						? ["Review recommended setup…", `${this.#state.searchFiltered.length} plugins`, "user"]
						: ["Review recommended setup…"],
					wide ? [inner - 33, 18, 9] : [inner - 2],
					selected,
				),
			);
		}
		if (!body.length || (wide && body.length === 1)) body.push(this.#emptyMessage());
		return { body, selectedBodyIndex };
	}

	override render(width: number): string[] {
		const rows = this.#rows();
		const inner = selectorFrameContentWidth(width);
		const wide = inner >= 68;
		const feedback = this.#feedbackLine();
		if (this.#operationInFlight) {
			return selectorFrame(
				width,
				rows,
				"Plugin operation",
				"",
				[],
				[],
				[feedback ?? "Working…", "This operation cannot be cancelled. Waiting for its outcome."],
				[],
			);
		}
		if (this.#view === "browse") {
			const { body, selectedBodyIndex } = this.#browseBody(inner, wide);
			const selected = this.#selectedPlugin();
			const details = [
				...(selected
					? [
							`${selected.displayName || selected.name} · ${pluginStatus(selected)} · ${pluginScope(selected)} scope`,
							selected.description ?? selected.id,
						]
					: this.#bulkSelected()
						? ["Review every recommended plugin and its prerequisite effects before installation."]
						: []),
				...(this.#state.warning ? [theme.fg("warning", this.#state.warning)] : []),
				...(this.#state.loading && !feedback ? [theme.fg("contentAccent", "Loading plugin information…")] : []),
				...(this.#state.loadError ? [theme.fg("error", `Unavailable: ${this.#state.loadError}`)] : []),
				...(feedback ? [feedback] : []),
			];
			return selectorFrame(
				width,
				rows,
				"Plugin manager",
				"",
				[
					...this.#renderTabs(wide),
					`Search plugins (${this.#state.searchFiltered.length ? this.#state.selectedIndex + 1 : 0}/${this.#state.searchFiltered.length})`,
					...this.#searchInput.render(inner),
				],
				body,
				details,
				[
					`Tab: sections · Ctrl+R: ${this.#state.loadError || this.#state.warning ? "retry" : "refresh"}`,
					`Esc: ${this.#state.searchQuery ? "clear search" : "back"}`,
				],
				{ selectedBodyIndex, stickyBodyRows: wide ? 1 : 0, minimumDetailRows: 1 },
			);
		}

		if (this.#view === "bulk-review") {
			const recommended = this.#state.allPlugins.filter(item => item.recommended && !item.installed);
			const review = this.#reviewBulk(recommended);
			const actions = ["Cancel setup", `Install ${recommended.length} plugins in user scope`];
			return selectorFrame(
				width,
				rows,
				"Review recommended setup",
				"",
				[],
				actions.map((action, index) => selectorRow([action], [inner - 2], index === this.#actionIndex)),
				[
					`Target: ${review.identity}`,
					...review.changes.map(change => `${change.field}: ${change.before} → ${change.after}`),
					review.consequence,
					...(feedback ? [feedback] : []),
				],
				["Esc: back"],
				{ selectedBodyIndex: this.#actionIndex },
			);
		}

		const plugin = this.#selectedPlugin();
		if (!plugin) {
			this.#view = "browse";
			return this.render(width);
		}
		if (this.#view === "details") {
			const actions = this.#detailsActions(plugin);
			const metadata = this.#metadata(plugin).flatMap(value => wrapTextWithAnsi(value, inner));
			const feedbackRows = feedback ? wrapTextWithAnsi(feedback, inner).length : 0;
			const availableRows = Math.max(1, rows - actions.length - 9 - feedbackRows);
			const scrolling = metadata.length > availableRows;
			const capacity = Math.max(1, availableRows - (scrolling ? 2 : 0));
			const start = Math.min(this.#detailOffset, Math.max(0, metadata.length - capacity));
			const visible = metadata.slice(start, start + capacity);
			if (metadata.length > capacity)
				visible.push(`Details ${start + 1}–${start + visible.length} of ${metadata.length}`);
			return selectorFrame(
				width,
				rows,
				"Plugin details",
				plugin.displayName || plugin.name,
				[],
				actions.map((action, index) => selectorRow([action], [inner - 2], index === this.#actionIndex)),
				[...visible, ...(feedback ? [feedback] : [])],
				[...(scrolling ? ["PgUp/PgDn: more details"] : []), "Esc: back"],
				{ selectedBodyIndex: this.#actionIndex, minimumDetailRows: 3 },
			);
		}

		if (this.#view === "enabled-review" && this.#enabledReview) {
			const review = this.#enabledReview;
			return selectorFrame(
				width,
				rows,
				"Review enabled state",
				plugin.displayName || plugin.name,
				[],
				["Cancel change", this.#proposedEnabled ? "Enable plugin" : "Disable plugin"].map((action, index) =>
					selectorRow([action], [inner - 2], index === this.#actionIndex),
				),
				[
					`Identifier: ${plugin.id}`,
					`Scope: ${review.scope}`,
					`Installed version: ${review.revision}`,
					...review.changes.map(change => `${change.field}: ${change.before} → ${change.after}`),
					review.consequence,
					...(feedback ? [feedback] : []),
				],
				["Esc: back"],
				{ selectedBodyIndex: this.#actionIndex },
			);
		}
		if (this.#view === "update-review") {
			const review = this.#reviewUpgrade(plugin);
			return selectorFrame(
				width,
				rows,
				"Review update",
				plugin.displayName || plugin.name,
				[],
				["Cancel update", `Update to ${plugin.updateVersion ?? "latest version"}`].map((action, index) =>
					selectorRow([action], [inner - 2], index === this.#actionIndex),
				),
				[
					`Target: ${review.identity.replaceAll("\0", " · ")}`,
					`Scope: ${review.scope}`,
					...review.changes.map(change => `${change.field}: ${change.before} → ${change.after}`),
					review.consequence,
					...(feedback ? [feedback] : []),
				],
				["Esc: back"],
				{ selectedBodyIndex: this.#actionIndex },
			);
		}
		if (this.#view === "install-review") {
			const actions = [
				"Cancel installation",
				"Install in user scope",
				...(this.#projectScopeAvailable ? ["Install in project scope"] : []),
			];
			const scope = this.#actionIndex === 2 ? "project" : "user";
			const review = this.#reviewInstall(plugin, scope);
			return selectorFrame(
				width,
				rows,
				"Review installation",
				plugin.displayName || plugin.name,
				[],
				actions.map((action, index) => selectorRow([action], [inner - 2], index === this.#actionIndex)),
				[
					`Target: ${review.identity.replaceAll("\0", " · ")}`,
					`Destination: ${this.#actionIndex === 2 ? "project scope" : this.#actionIndex === 1 ? "user scope" : "user scope (Cancel selected)"}`,
					...review.changes.map(change => `${change.field}: ${change.before} → ${change.after}`),
					review.consequence,
					...(!this.#projectScopeAvailable ? ["Project scope is unavailable outside an active project."] : []),
					...(feedback ? [feedback] : []),
				],
				["Esc: back"],
				{ selectedBodyIndex: this.#actionIndex },
			);
		}

		if (this.#view === "remove-confirm") {
			const review = this.#reviewRemoval(plugin);
			const actions = ["Cancel removal", `Remove from ${pluginScope(plugin)} scope`];
			return selectorFrame(
				width,
				rows,
				`Remove ${plugin.displayName || plugin.name}?`,
				"Removal deletes this installed copy. Other scoped copies are unchanged.",
				[],
				actions.map((action, index) => selectorRow([action], [inner - 2], index === this.#actionIndex)),
				[
					`Target: ${review.identity.replaceAll("\0", " · ")}`,
					`Scope: ${review.scope}`,
					...review.changes.map(change => `${change.field}: ${change.before} → ${change.after}`),
					review.consequence,
					...(feedback ? [feedback] : []),
				],
				["Esc: back"],
				{ selectedBodyIndex: this.#actionIndex },
			);
		}

		return [];
	}

	handleInput(data: string): void {
		if (this.#operationInFlight) return;
		if (matchesKey(data, "ctrl+c")) {
			// Ctrl+C belongs to interruption, never to menu navigation.
			return;
		}
		if (this.#view === "browse") {
			if (matchesKey(data, "escape")) {
				if (this.#searchInput.getValue()) {
					this.#searchInput.setValue("");
					this.#applyFilters();
					this.#requestRender();
				} else if (this.#operationInFlight) {
					this.#feedback = {
						kind: "warning",
						message: "The operation is still running. This view will stay open until its outcome is known.",
					};
					this.#requestRender();
				} else {
					this.#closed = true;
					this.onClose?.();
				}
			} else if (matchesKey(data, "tab")) this.#switchTab(1);
			else if (matchesKey(data, "shift+tab")) this.#switchTab(-1);
			else if (matchesSelectorKey(data, "up")) this.#moveSelection(-1);
			else if (matchesSelectorKey(data, "down")) this.#moveSelection(1);
			else if (matchesSelectorKey(data, "confirm")) {
				this.#openDetails();
				this.#requestRender();
			} else if (matchesKey(data, "ctrl+r")) void this.#reload(true);
			else {
				const before = this.#searchInput.getValue();
				this.#searchInput.handleInput(data);
				if (this.#searchInput.getValue() !== before) {
					this.#state.selectedIndex = 0;
					this.#feedback = undefined;
					this.#applyFilters();
					this.#requestRender();
				}
			}
			return;
		}

		if (matchesKey(data, "escape")) {
			if (this.#view === "details") this.#view = "browse";
			else if (
				this.#view === "install-review" ||
				this.#view === "update-review" ||
				this.#view === "remove-confirm" ||
				this.#view === "enabled-review"
			)
				this.#view = "details";
			else this.#view = "browse";
			this.#actionIndex = 0;
			this.#requestRender();
			return;
		}

		const plugin = this.#selectedPlugin();
		const actionCount =
			this.#view === "details"
				? plugin
					? this.#detailsActions(plugin).length
					: 0
				: this.#view === "install-review"
					? this.#projectScopeAvailable
						? 3
						: 2
					: 2;
		if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down")) {
			if (actionCount)
				this.#actionIndex =
					(this.#actionIndex + (matchesSelectorKey(data, "up") ? -1 : 1) + actionCount) % actionCount;
			this.#requestRender();
		} else if (this.#view === "details" && matchesSelectorKey(data, "pageUp")) {
			this.#detailOffset = Math.max(0, this.#detailOffset - 3);
			this.#requestRender();
		} else if (this.#view === "details" && matchesSelectorKey(data, "pageDown")) {
			this.#detailOffset += 3;
			this.#requestRender();
		} else if (matchesSelectorKey(data, "confirm")) {
			if (this.#operationInFlight) return;
			if (this.#view === "details") this.#activateDetailAction();
			else if (this.#view === "enabled-review") {
				if (this.#actionIndex === 0) this.#view = "details";
				else if (this.#enabledReview) {
					const review = this.#enabledReview;
					const enabled = this.#proposedEnabled;
					void this.#runOperation(enabled ? "Enable" : "Disable", () =>
						executeReviewedAction(
							review,
							async () => {
								const plugins = await this.#operations.load();
								const target = plugins.find(
									item => item.installed && pluginSelectionKey(item) === review.identity,
								);
								this.#replacePlugins(plugins, review.identity);
								return target ? { target, review: this.#reviewEnabled(target, enabled) } : undefined;
							},
							target => this.#operations.setEnabled(target, enabled),
						),
					);
				}
			} else if (this.#view === "install-review") {
				if (this.#actionIndex === 0) this.#view = "details";
				else if (plugin) {
					const scope = this.#actionIndex === 2 ? "project" : "user";
					const review = this.#reviewInstall(plugin, scope);
					void this.#runOperation(
						"Installation",
						() =>
							executeReviewedAction(
								review,
								async () => {
									const plugins = await this.#operations.load();
									const target = plugins.find(
										item => item.source === plugin.source && item.id === plugin.id && !item.installed,
									);
									return target ? { target, review: this.#reviewInstall(target, scope) } : undefined;
								},
								target => this.#operations.install(target, scope),
							),
						() => {
							plugin.installed = true;
							plugin.enabled = true;
							plugin.scope = scope;
						},
					);
				}
			} else if (this.#view === "update-review") {
				if (this.#actionIndex === 0) this.#view = "details";
				else if (plugin) {
					const review = this.#reviewUpgrade(plugin);
					void this.#runOperation("Upgrade", () =>
						executeReviewedAction(
							review,
							async () => {
								const plugins = await this.#operations.load();
								const target = plugins.find(
									item => item.installed && pluginSelectionKey(item) === review.identity,
								);
								return target ? { target, review: this.#reviewUpgrade(target) } : undefined;
							},
							target => this.#operations.upgrade(target),
						),
					);
				}
			} else if (this.#view === "remove-confirm") {
				if (this.#actionIndex === 0) this.#view = "details";
				else if (plugin) {
					const review = this.#reviewRemoval(plugin);
					void this.#runOperation(
						"Removal",
						() =>
							executeReviewedAction(
								review,
								async () => {
									const plugins = await this.#operations.load();
									const target = plugins.find(
										item => item.installed && pluginSelectionKey(item) === review.identity,
									);
									return target ? { target, review: this.#reviewRemoval(target) } : undefined;
								},
								target => this.#operations.remove(target),
							),
						() => {
							plugin.installed = false;
						},
					);
				}
			} else if (this.#actionIndex === 0) this.#view = "browse";
			else void this.#runBulkInstall();
			this.#requestRender();
		}
	}
}
