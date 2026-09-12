import { isDeepStrictEqual } from "node:util";
import type { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { Effort } from "@f5-sales-demo/pi-ai";
import { Container, matchesKey, type SettingItem, type Tab, TabBar, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { type SettingPath, type Settings, settings } from "../../config/settings";
import type {
	SettingTab,
	StatusLinePreset,
	StatusLineSegmentId,
	StatusLineSeparatorStyle,
} from "../../config/settings-schema";
import { SETTING_TABS, TAB_METADATA } from "../../config/settings-schema";
import { getCurrentThemeName, theme } from "../../modes/theme/theme";
import { getTabBarTheme } from "../shared";
import { PluginSettingsComponent } from "./plugin-settings";
import { PluginSettingsDrafts, type PluginSettingsStorage, pluginSettingsStorage } from "./plugin-settings-drafts";
import { matchesSelectorKey, selectorFrame, selectorFrameContentWidth, selectorRow } from "./selector-frame";
import { SettingsBrowser } from "./settings-browser";
import { getSettingsForTab, type SettingDef } from "./settings-defs";
import { SettingsChoiceEditor, SettingsTextEditor } from "./settings-editors";
import { getPreset } from "./status-line/presets";

/**
 * Format the displayed value for a submenu-type setting row.
 *
 * Pure helper so the active-theme indicator and default-sentinel mappings can
 * be unit-tested without rendering the TUI. Called from
 * `#getSubmenuCurrentValue` with the current theme name injected by the caller.
 */
export function formatSubmenuCurrentValue(
	path: SettingPath,
	value: string,
	currentThemeName: string | undefined,
): string {
	if (path === "compaction.thresholdPercent" && (value === "-1" || value === "")) {
		return "default";
	}
	if (path === "compaction.thresholdTokens" && (value === "-1" || value === "")) {
		return "default";
	}
	if ((path === "theme.dark" || path === "theme.light") && currentThemeName && value === currentThemeName) {
		return `${value} (active)`;
	}
	return value;
}

function getSettingsTabs(): Tab[] {
	return [
		...SETTING_TABS.map(id => {
			const meta = TAB_METADATA[id];
			const icon = theme.symbol(meta.icon as Parameters<typeof theme.symbol>[0]);
			return { id, label: `${icon} ${meta.label}` };
		}),
		{ id: "plugins", label: `${theme.icon.package} Plugins` },
	];
}

/**
 * Dynamic context for settings that need runtime data.
 * Some settings (like thinking level) are managed by the session, not Settings.
 */
export interface SettingsRuntimeContext {
	/** Available thinking levels (from session) */
	availableThinkingLevels: Effort[];
	/** Current thinking level (from session) */
	thinkingLevel: ThinkingLevel | undefined;
	/** Available themes */
	availableThemes: string[];
	/** Working directory for plugins tab */
	cwd: string;
	/** Optional isolated backing store for deterministic scenarios. */
	settings?: Settings;
	pluginStorage?: PluginSettingsStorage;
}

/** Status line settings subset for preview */
export interface StatusLinePreviewSettings {
	preset?: StatusLinePreset;
	leftSegments?: StatusLineSegmentId[];
	rightSegments?: StatusLineSegmentId[];
	separator?: StatusLineSeparatorStyle;
}

export interface SettingsCallbacks {
	/** Called when any setting value changes */
	onChange: (path: SettingPath, newValue: unknown) => void;
	/** Called for theme preview while browsing */
	onThemePreview?: (theme: string) => void | Promise<void>;
	/** Called for status line preview while configuring */
	onStatusLinePreview?: (settings: StatusLinePreviewSettings) => void;
	/** Get current rendered status line for inline preview */
	getStatusLinePreview?: () => string;
	/** Called when plugins change */
	onPluginsChanged?: () => void;
	/** Called only after every reviewed backing save succeeds. */
	onSaved?: (changeCount: number, kind: "settings" | "plugin" | "combined") => void;
	/** Called when settings panel is closed */
	onCancel: () => void;
	/** Refresh asynchronous save/recovery state. */
	onRequestRender?: () => void;
}

/**
 * Main tabbed settings selector component.
 * Uses declarative settings definitions from settings-defs.ts.
 */
export class SettingsSelectorComponent extends Container {
	#tabBar: TabBar;
	#currentList: SettingsBrowser | null = null;
	#browsers = new Map<SettingTab, SettingsBrowser>();
	#pluginComponent: PluginSettingsComponent | null = null;
	#cachedPluginComponent: PluginSettingsComponent | null = null;
	#currentTabId: SettingTab | "plugins" = "appearance";
	#drafts = new Map<SettingPath, { before: unknown; after: unknown }>();
	#pluginDrafts = new PluginSettingsDrafts();
	get #pluginStorage(): PluginSettingsStorage {
		return this.context.pluginStorage ?? pluginSettingsStorage(this.context.cwd);
	}
	get #draftCount(): number {
		return this.#drafts.size + this.#pluginDrafts.size;
	}
	#review: "save" | "leave" | null = null;
	#reviewIndex = 0;
	#reviewOffset = 0;
	#saving = false;
	#pendingPersistence = false;
	#saveError = "";
	#initialTheme = getCurrentThemeName();
	#submenuActive = false;

	get #store(): Settings {
		return this.context.settings ?? settings;
	}
	#value(path: SettingPath): unknown {
		return this.#drafts.has(path) ? this.#drafts.get(path)!.after : this.#store.get(path);
	}
	#stage(path: SettingPath, after: unknown): void {
		const before = this.#drafts.get(path)?.before ?? this.#store.get(path);
		if (isDeepStrictEqual(before, after)) this.#drafts.delete(path);
		else this.#drafts.set(path, { before: structuredClone(before), after: structuredClone(after) });
	}
	#leave(): void {
		if (this.#draftCount) {
			this.#review = "leave";
			this.#reviewIndex = 0;
		} else this.callbacks.onCancel();
	}
	async #discard(): Promise<void> {
		if (this.#saving) return;
		this.#saving = true;
		this.#saveError = "";
		try {
			if (this.#initialTheme) await this.callbacks.onThemePreview?.(this.#initialTheme);
			this.#triggerStatusLinePreview(true);
			this.#drafts.clear();
			this.#pluginDrafts.clear();
			this.callbacks.onCancel();
		} catch (error) {
			this.#saveError = `Could not restore previews: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			this.#saving = false;
			this.callbacks.onRequestRender?.();
		}
	}
	async #save(): Promise<void> {
		if (this.#saving) return;
		this.#saving = true;
		this.#saveError = "";
		const reviewedChangeCount = this.#draftCount;
		const reviewedSettingsCount = this.#drafts.size;
		const reviewedPluginCount = this.#pluginDrafts.size;
		try {
			if (this.#pluginDrafts.size) this.#pluginDrafts.validate(await this.#pluginStorage.load());
			for (const [path, draft] of this.#drafts) {
				const current = this.#store.get(path);
				if (!isDeepStrictEqual(current, draft.before) && !isDeepStrictEqual(current, draft.after)) {
					draft.before = structuredClone(current);
					this.#reviewIndex = 0;
					throw new Error(`${path} changed. Review the updated values before saving.`);
				}
			}
			this.#pendingPersistence = true;
			for (const [path, draft] of this.#drafts) {
				if (!isDeepStrictEqual(this.#store.get(path), draft.after)) this.#store.set(path, draft.after as never);
			}
			await this.#store.flush({ throwOnError: true });
			for (const [path, draft] of this.#drafts) {
				this.callbacks.onChange(path, draft.after);
				this.#drafts.delete(path);
			}
			if (this.#pluginDrafts.size) {
				const storage = this.#pluginStorage;
				await this.#pluginDrafts.save(
					() => storage.load(),
					(next, reviewed) => storage.write(next, reviewed),
				);
				this.callbacks.onPluginsChanged?.();
			}
			this.#pendingPersistence = false;
			this.#review = null;
			this.callbacks.onSaved?.(
				reviewedChangeCount,
				reviewedSettingsCount && reviewedPluginCount ? "combined" : reviewedPluginCount ? "plugin" : "settings",
			);
			this.callbacks.onCancel();
		} catch (error) {
			this.#saveError = error instanceof Error ? error.message : String(error);
			if (this.#pendingPersistence)
				this.#saveError += " Some changes may already be applied; retry unresolved saves before leaving.";
		} finally {
			this.#saving = false;
			this.callbacks.onRequestRender?.();
		}
	}

	override render(width: number): string[] {
		if (!this.#review)
			return this.#currentList?.render(width) ?? this.#pluginComponent?.render(width) ?? super.render(width);
		const rows = process.stdout.rows || 24;
		const inner = selectorFrameContentWidth(width);
		const actions = this.#pendingPersistence
			? ["Keep reviewing", "Retry save"]
			: this.#review === "leave"
				? ["Keep editing", "Discard changes"]
				: ["Cancel save", "Save changes"];
		const changes = [...this.#drafts].flatMap(([path, value]) =>
			wrapTextWithAnsi(
				`${path}: ${/secret|token|password|credential|api.?key/i.test(path) ? "[masked] → [masked]" : `${JSON.stringify(value.before)} → ${JSON.stringify(value.after)}`}`,
				inner,
			),
		);
		const capacity = Math.max(1, rows - 13);
		changes.push(...this.#pluginDrafts.reviewLines().flatMap(line => wrapTextWithAnsi(line, inner)));
		this.#reviewOffset = Math.min(this.#reviewOffset, Math.max(0, changes.length - capacity));
		return selectorFrame(
			width,
			rows,
			this.#review === "leave" ? "Unsaved settings" : "Review settings",
			"Scope: user settings · Applies across future sessions",
			[],
			this.#saving
				? [this.#review === "leave" ? "Restoring settings…" : "Saving settings…"]
				: actions.map((label, i) => selectorRow([label], [inner - 2], i === this.#reviewIndex)),
			[...changes.slice(this.#reviewOffset, this.#reviewOffset + capacity), this.#saveError],
			[
				...(changes.length > capacity ? ["PgUp/PgDn: more changes"] : []),
				this.#pendingPersistence ? "Pending save must be resolved before leaving" : "Esc: keep editing",
			],
			{ selectedBodyIndex: this.#reviewIndex },
		);
	}

	constructor(
		private readonly context: SettingsRuntimeContext,
		private readonly callbacks: SettingsCallbacks,
	) {
		super();

		// Tab bar
		this.#tabBar = new TabBar("Settings", getSettingsTabs(), getTabBarTheme());
		this.#tabBar.onTabChange = () => {
			this.#switchToTab(this.#tabBar.getActiveTab().id as SettingTab | "plugins");
		};
		// Initialize with first tab
		this.#switchToTab("appearance");
	}

	#switchToTab(tabId: SettingTab | "plugins"): void {
		this.#currentTabId = tabId;

		// Remove current content
		if (this.#currentList) {
			this.removeChild(this.#currentList);
			this.#currentList = null;
		}
		if (this.#pluginComponent) {
			this.removeChild(this.#pluginComponent);
			this.#pluginComponent = null;
		}
		if (tabId === "plugins") {
			this.#showPluginsTab();
		} else {
			this.#showSettingsTab(tabId);
		}
	}

	/**
	 * Convert a setting definition to a SettingItem for the UI.
	 */
	#defToItem(def: SettingDef): SettingItem | null {
		// Check condition
		if (def.type === "boolean" && def.condition && !def.condition()) {
			return null;
		}

		const currentValue = this.#getCurrentValue(def);

		switch (def.type) {
			case "boolean":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: currentValue ? "true" : "false",
					submenu: (cv, done) => this.#createChoice(def, ["true", "false"], cv, done),
				};

			case "enum":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: currentValue as string,
					submenu: (cv, done) => this.#createChoice(def, def.values, cv, done),
				};

			case "submenu":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: this.#getSubmenuCurrentValue(def.path, currentValue),
					submenu: (_cv, done) =>
						this.#createSubmenu(
							def,
							def.path.startsWith("compaction.threshold") && this.#value(def.path) === -1
								? "default"
								: String(this.#value(def.path) ?? ""),
							done,
						),
				};

			case "text":
				return {
					id: def.path,
					label: def.label,
					description: def.description,
					currentValue: (currentValue as string) ?? "",
					submenu: (cv, done) => this.#createTextInput(def, cv, done),
				};
		}
	}

	/**
	 * Get the current value for a setting.
	 */
	#getCurrentValue(def: SettingDef): unknown {
		return this.#value(def.path);
	}

	#createChoice(
		def: SettingDef,
		values: readonly string[],
		current: string,
		done: (value?: string) => void,
	): Container {
		this.#submenuActive = true;
		const finish = (value?: string) => {
			this.#submenuActive = false;
			done(value);
		};
		return new SettingsChoiceEditor(
			def.label,
			def.description,
			values.map(value => ({ value, label: value })),
			current,
			finish,
			() => finish(),
		);
	}

	#getSubmenuCurrentValue(path: SettingPath, value: unknown): string {
		return formatSubmenuCurrentValue(path, String(value ?? ""), getCurrentThemeName());
	}

	/**
	 * Create a submenu for a submenu-type setting.
	 */
	#createSubmenu(
		def: SettingDef & { type: "submenu" },
		currentValue: string,
		done: (value?: string) => void,
	): Container {
		this.#submenuActive = true;
		const originalDone = done;
		done = value => {
			this.#submenuActive = false;
			originalDone(value);
		};
		let options = def.options;

		// Special case: inject runtime options for thinking level
		if (def.path === "defaultThinkingLevel") {
			options = this.context.availableThinkingLevels.map(level => {
				const baseOpt = options.find(o => o.value === level);
				return baseOpt || { value: level, label: level };
			});
		} else if (def.path === "theme.dark" || def.path === "theme.light") {
			options = this.context.availableThemes.map(t => ({ value: t, label: t }));
		}

		// Preview handlers
		let onPreview: ((value: string) => void | Promise<void>) | undefined;
		let onPreviewCancel: (() => void | Promise<void>) | undefined;

		const activeThemeBeforePreview = getCurrentThemeName() ?? currentValue;
		if (def.path === "theme.dark" || def.path === "theme.light") {
			onPreview = value => {
				return this.callbacks.onThemePreview?.(value);
			};
			onPreviewCancel = () => {
				return this.callbacks.onThemePreview?.(activeThemeBeforePreview);
			};
		} else if (def.path === "statusLine.preset") {
			onPreview = value => {
				const presetDef = getPreset(
					value as "default" | "minimal" | "compact" | "full" | "nerd" | "ascii" | "custom",
				);
				this.callbacks.onStatusLinePreview?.({
					preset: value as StatusLinePreset,
					leftSegments: presetDef.leftSegments,
					rightSegments: presetDef.rightSegments,
					separator: presetDef.separator,
				});
				this.#updateStatusPreview();
			};
			onPreviewCancel = () => {
				const currentPreset = this.#value("statusLine.preset") as StatusLinePreset;
				const presetDef = getPreset(currentPreset);
				this.callbacks.onStatusLinePreview?.({
					preset: currentPreset,
					leftSegments: presetDef.leftSegments,
					rightSegments: presetDef.rightSegments,
					separator: presetDef.separator,
				});
				this.#updateStatusPreview();
			};
		} else if (def.path === "statusLine.separator") {
			onPreview = value => {
				this.callbacks.onStatusLinePreview?.({ separator: value as StatusLineSeparatorStyle });
				this.#updateStatusPreview();
			};
			onPreviewCancel = () => {
				const separator = this.#value("statusLine.separator") as StatusLineSeparatorStyle;
				this.callbacks.onStatusLinePreview?.({ separator });
				this.#updateStatusPreview();
			};
		}

		// Provide status line preview for theme selection
		const isThemeSetting = def.path === "theme.dark" || def.path === "theme.light";
		const getPreview = isThemeSetting ? this.callbacks.getStatusLinePreview : undefined;

		return new SettingsChoiceEditor(
			def.label,
			def.description,
			options,
			currentValue,
			value => {
				this.#setSettingValue(def.path, value);
				done(value);
			},
			async () => {
				await onPreviewCancel?.();
				done();
			},
			onPreview,
			getPreview,
			this.callbacks.onRequestRender,
		);
	}

	/**
	 * Create a text input submenu for a plain string setting.
	 */
	#createTextInput(
		def: SettingDef & { type: "text" },
		currentValue: string,
		done: (value?: string) => void,
	): Container {
		this.#submenuActive = true;
		const wrappedDone = (value?: string) => {
			this.#submenuActive = false;
			done(value);
		};
		return new SettingsTextEditor(
			def.label,
			def.description,
			currentValue,
			value => {
				// Empty string clears the setting; undefined-typed string settings
				// store "" which the browser.ts expandPath ignores (no-op fallback).
				this.#setSettingValue(def.path, value);
				wrappedDone(value);
			},
			() => wrappedDone(),
		);
	}

	/**
	 * Set a setting value, handling type conversion.
	 */
	#setSettingValue(path: SettingPath, value: string): void {
		// Handle number conversions
		const currentValue = this.#store.get(path);
		if (path === "compaction.thresholdPercent" && value === "default") {
			this.#stage(path, -1);
		} else if (path === "compaction.thresholdTokens" && value === "default") {
			this.#stage(path, -1);
		} else if (typeof currentValue === "number") {
			this.#stage(path, Number(value));
		} else if (typeof currentValue === "boolean") {
			this.#stage(path, value === "true");
		} else {
			this.#stage(path, value);
		}
	}

	/**
	 * Show a settings tab using definitions.
	 */
	#showSettingsTab(tabId: SettingTab): void {
		const existing = this.#browsers.get(tabId);
		if (existing) {
			this.#currentList = existing;
			this.addChild(existing);
			return;
		}
		const defs = getSettingsForTab(tabId);
		const items: SettingItem[] = [];

		for (const def of defs) {
			const item = this.#defToItem(def);
			if (item) {
				items.push(item);
			}
		}

		this.#currentList = new SettingsBrowser(
			items,
			() => [
				getSettingsTabs().find(tab => tab.id === this.#currentTabId)!.label,
				...(tabId === "appearance" ? [`Preview: ${this.#getStatusPreviewString()}`] : []),
				...(this.#draftCount ? [`${this.#draftCount} unsaved changes · Ctrl+S: review changes`] : []),
			],
			(id, newValue) => {
				const def = defs.find(d => d.path === id);
				if (!def) return;

				const path = def.path;

				if (def.type === "boolean") {
					const boolValue = newValue === "true";
					this.#stage(path, boolValue);

					if (tabId === "appearance") {
						this.#triggerStatusLinePreview();
					}
				} else if (def.type === "enum") {
					this.#stage(path, newValue);
				}
				// Submenu types are handled in createSubmenu
			},
			() => this.#leave(),
		);
		this.#browsers.set(tabId, this.#currentList);
		this.addChild(this.#currentList);
	}

	/**
	 * Get the status line preview string.
	 */
	#getStatusPreviewString(): string {
		if (this.callbacks.getStatusLinePreview) {
			return this.callbacks.getStatusLinePreview();
		}
		return theme.fg("dim", "(preview not available)");
	}

	/**
	 * Trigger status line preview with current settings.
	 */
	#triggerStatusLinePreview(saved = false): void {
		const value = (path: SettingPath) => (saved ? this.#store.get(path) : this.#value(path));
		const statusLineSettings: StatusLinePreviewSettings = {
			preset: value("statusLine.preset") as StatusLinePreset,
			leftSegments: value("statusLine.leftSegments") as StatusLineSegmentId[],
			rightSegments: value("statusLine.rightSegments") as StatusLineSegmentId[],
			separator: value("statusLine.separator") as StatusLineSeparatorStyle,
		};
		this.callbacks.onStatusLinePreview?.(statusLineSettings);
		this.#updateStatusPreview();
	}

	/**
	 * Update the inline status preview text.
	 */
	#updateStatusPreview(): void {
		if (this.#currentTabId === "appearance") this.callbacks.onRequestRender?.();
	}

	#showPluginsTab(): void {
		this.#pluginComponent =
			this.#cachedPluginComponent ??
			new PluginSettingsComponent(
				this.context.cwd,
				{
					onClose: () => this.#leave(),
					onPluginChanged: () => this.callbacks.onPluginsChanged?.(),
					onDraftChanged: () => this.callbacks.onRequestRender?.(),
					getDraftSummary: () =>
						this.#draftCount ? [`${this.#draftCount} unsaved changes · Ctrl+S: review changes`] : [],
				},
				this.#pluginDrafts,
				this.#pluginStorage,
			);
		this.#cachedPluginComponent = this.#pluginComponent;
		this.addChild(this.#pluginComponent);
	}

	getFocusComponent(): SettingsBrowser | PluginSettingsComponent {
		// Return the current focusable component - one of these will always be set
		return (this.#currentList || this.#pluginComponent)!;
	}

	handleInput(data: string): void {
		if (this.#saving) return;
		if (this.#review) {
			if (matchesSelectorKey(data, "cancel") && !this.#pendingPersistence) this.#review = null;
			else if (matchesSelectorKey(data, "up") || matchesSelectorKey(data, "down"))
				this.#reviewIndex = 1 - this.#reviewIndex;
			else if (matchesSelectorKey(data, "pageDown")) this.#reviewOffset += 3;
			else if (matchesSelectorKey(data, "pageUp")) this.#reviewOffset = Math.max(0, this.#reviewOffset - 3);
			else if (matchesSelectorKey(data, "confirm")) {
				if (this.#reviewIndex === 0) {
					if (!this.#pendingPersistence) this.#review = null;
				} else if (this.#review === "save") void this.#save();
				else void this.#discard();
			}
			return;
		}
		const editing = this.#submenuActive || this.#pluginComponent?.editing;
		if (!editing && matchesKey(data, "ctrl+s") && this.#draftCount) {
			this.#review = "save";
			this.#reviewIndex = 0;
			this.#reviewOffset = 0;
			return;
		}
		// Handle tab switching — but NOT when a text input is active, since
		// arrow keys must reach the cursor and Tab must not switch tabs.
		if (!editing && (matchesKey(data, "tab") || matchesKey(data, "shift+tab"))) {
			this.#tabBar.handleInput(data);
			return;
		}

		// Pass to current content
		if (this.#currentList) {
			this.#currentList.handleInput(data);
		} else if (this.#pluginComponent) {
			this.#pluginComponent.handleInput(data);
		}
	}
}
