/**
 * Plugin settings UI components.
 *
 * Provides a hierarchical settings interface:
 * - Plugin list (shows all installed plugins)
 *   - Plugin detail (enable/disable, features, config)
 *     - Feature toggles
 *     - Config value editor
 */
import { Container, type SettingItem, Text } from "@f5-sales-demo/pi-tui";
import { PluginManager } from "../../extensibility/plugins/manager";
import type { InstalledPlugin, PluginSettingSchema } from "../../extensibility/plugins/types";
import {
	PluginSettingsDrafts,
	type PluginSettingsSnapshot,
	type PluginSettingsStorage,
	pluginSettingsStorage,
} from "./plugin-settings-drafts";
import { matchesSelectorKey, selectorFrame } from "./selector-frame";
import { SettingsBrowser } from "./settings-browser";
import { SettingsChoiceEditor, SettingsTextEditor } from "./settings-editors";

// =============================================================================
// Plugin List Component
// =============================================================================

export interface PluginListCallbacks {
	getDraftSummary?: () => string[];
	onPluginSelect: (plugin: InstalledPlugin) => void;
	onCancel: () => void;
}

/**
 * Shows list of installed plugins with enable/disable status.
 * Selecting a plugin opens its detail view.
 */
export class PluginListComponent extends Container {
	#browser: SettingsBrowser;
	constructor(
		private plugins: InstalledPlugin[],
		callbacks: PluginListCallbacks,
	) {
		super();
		this.#browser = new SettingsBrowser(
			this.#items(),
			() => callbacks.getDraftSummary?.() ?? [],
			() => {},
			callbacks.onCancel,
			{
				title: "Plugin settings",
				purpose: "User defaults · Project overrides may remain effective",
				details: item => `${item.label} · ${item.description ?? ""}`,
				open: item => {
					const plugin = this.plugins.find(plugin => JSON.stringify([plugin.name, plugin.path]) === item.id);
					if (plugin) callbacks.onPluginSelect(plugin);
				},
			},
		);
		this.addChild(this.#browser);
	}
	#items(): SettingItem[] {
		return this.plugins.map(plugin => ({
			id: JSON.stringify([plugin.name, plugin.path]),
			label: plugin.name,
			currentValue: plugin.enabled ? "Enabled" : "Disabled",
			description: `v${plugin.version} · ${plugin.path} · ${plugin.manifest.description ?? ""}`,
		}));
	}
	updatePlugins(plugins: InstalledPlugin[]): void {
		this.plugins = plugins;
		this.#browser.updateItems(this.#items());
	}
	handleInput(data: string): void {
		this.#browser.handleInput(data);
	}
}

// =============================================================================
// Plugin Detail Component
// =============================================================================

export interface PluginDetailCallbacks {
	getDraftSummary?: () => string[];
	onEnabledChange: (enabled: boolean) => void;
	onFeatureChange: (feature: string, enabled: boolean) => void;
	onConfigChange: (key: string, value: unknown) => void;
	onBack: () => void;
}

/**
 * Shows detail settings for a single plugin:
 * - Enable/disable toggle
 * - Feature toggles
 * - Config settings
 */
export class PluginDetailComponent extends Container {
	#settingsList!: SettingsBrowser;
	#editing = false;
	get editing(): boolean {
		return this.#editing;
	}

	constructor(
		private plugin: InstalledPlugin,
		private readonly manager: PluginManager,
		private readonly callbacks: PluginDetailCallbacks,
		private readonly draftSettings?: Record<string, unknown>,
	) {
		super();

		void this.#rebuild();
	}

	async #rebuild(): Promise<void> {
		this.clear();

		const plugin = this.plugin;
		const manifest = plugin.manifest;

		// Header

		const items: SettingItem[] = [];

		// Enable/disable toggle
		items.push({
			id: "__enabled__",
			label: "Enabled",
			description: "Enable or disable this plugin",
			currentValue: plugin.enabled ? "true" : "false",
			values: ["true", "false"],
		});

		// Feature toggles
		if (manifest.features && Object.keys(manifest.features).length > 0) {
			const enabledSet = new Set(plugin.enabledFeatures ?? []);
			const defaultFeatures = Object.entries(manifest.features)
				.filter(([_, f]) => f.default)
				.map(([name]) => name);

			// If enabledFeatures is null, use defaults
			const effectiveEnabled = plugin.enabledFeatures === null ? new Set(defaultFeatures) : enabledSet;

			for (const [featName, feat] of Object.entries(manifest.features)) {
				const isEnabled = effectiveEnabled.has(featName);
				items.push({
					id: `feature:${featName}`,
					label: `  ${featName}`,
					description: feat.description || `Enable ${featName} feature`,
					currentValue: isEnabled ? "true" : "false",
					values: ["true", "false"],
				});
			}
		}

		// Config settings
		if (manifest.settings && Object.keys(manifest.settings).length > 0) {
			const settings = this.draftSettings ?? (await this.manager.getPluginSettings(plugin.name));

			for (const [key, schema] of Object.entries(manifest.settings)) {
				const currentValue = settings[key] ?? schema.default;
				const displayValue = schema.secret && currentValue ? "••••••••" : String(currentValue ?? "(not set)");

				if (schema.type === "boolean") {
					items.push({
						id: `config:${key}`,
						label: `  ${key}`,
						description: schema.description || `Configure ${key}`,
						currentValue: currentValue ? "true" : "false",
						values: ["true", "false"],
					});
				} else if (schema.type === "enum") {
					items.push({
						id: `config:${key}`,
						label: `  ${key}`,
						description: schema.description || `Configure ${key}`,
						currentValue: String(currentValue ?? schema.default ?? ""),
						submenu: (cv, done) =>
							new ConfigEnumSubmenu(
								key,
								schema.description || `Select value for ${key}`,
								schema.values,
								cv,
								value => {
									this.callbacks.onConfigChange(key, value);
									done(value);
								},
								() => done(),
							),
					});
				} else {
					// string or number - show as submenu with input
					items.push({
						id: `config:${key}`,
						label: `  ${key}`,
						description: schema.description || `Configure ${key}`,
						currentValue: displayValue,
						submenu: (cv, done) =>
							new ConfigInputSubmenu(
								key,
								schema,
								cv === "(not set)" ? "" : cv,
								value => {
									const parsed = schema.type === "number" ? Number(value) : value;
									this.callbacks.onConfigChange(key, parsed);
									done(schema.secret ? "••••••••" : String(value));
								},
								() => done(),
							),
					});
				}
			}
		}

		for (const item of items) {
			if (!item.values) continue;
			const values = item.values;
			item.submenu = (current, done) =>
				new SettingsChoiceEditor(
					item.label,
					item.description ?? "",
					values.map(value => ({ value, label: value })),
					current,
					done,
					() => done(),
				);
			delete item.values;
		}
		for (const item of items) {
			const submenu = item.submenu;
			if (!submenu) continue;
			item.submenu = (current, done) => {
				this.#editing = true;
				return submenu(current, value => {
					done(value);
					this.#editing = false;
				});
			};
		}
		this.#settingsList = new SettingsBrowser(
			items,
			() => this.callbacks.getDraftSummary?.() ?? [],
			(id, newValue) => {
				if (id === "__enabled__") {
					this.callbacks.onEnabledChange(newValue === "true");
					this.plugin = { ...this.plugin, enabled: newValue === "true" };
				} else if (id.startsWith("feature:")) {
					const featName = id.slice(8);
					this.callbacks.onFeatureChange(featName, newValue === "true");
					// Update local state
					const current = new Set(this.plugin.enabledFeatures ?? []);
					if (newValue === "true") {
						current.add(featName);
					} else {
						current.delete(featName);
					}
					this.plugin = { ...this.plugin, enabledFeatures: [...current] };
				} else if (id.startsWith("config:")) {
					const key = id.slice(7);
					const schema = this.plugin.manifest.settings?.[key];
					if (schema?.type === "boolean") {
						this.callbacks.onConfigChange(key, newValue === "true");
					}
				}
			},
			this.callbacks.onBack,
			{
				title: plugin.name,
				purpose: `User defaults · v${plugin.version} · ${plugin.path}`,
				footer: [],
				details: item => `${item.label.trim()}: ${item.description ?? ""}`,
			},
		);

		this.addChild(this.#settingsList);
	}

	handleInput(data: string): void {
		if (!this.#settingsList) return;
		this.#settingsList.handleInput(data);
	}
}

// =============================================================================
// Config Submenus
// =============================================================================

/**
 * Submenu for enum config values.
 */
class ConfigEnumSubmenu extends SettingsChoiceEditor {
	constructor(
		key: string,
		description: string,
		values: string[],
		current: string,
		onSelect: (value: string) => void,
		onCancel: () => void,
	) {
		super(
			key,
			description,
			values.map(value => ({ value, label: value })),
			current,
			onSelect,
			onCancel,
		);
	}
}

class ConfigInputSubmenu extends SettingsTextEditor {
	constructor(
		key: string,
		schema: PluginSettingSchema,
		current: string,
		onSubmit: (value: string) => void,
		onCancel: () => void,
	) {
		const range =
			schema.type === "number" ? ` · Range: ${schema.min ?? "unbounded"}..${schema.max ?? "unbounded"}` : "";
		super(
			key,
			`${schema.description ?? ""} · Type: ${schema.type}${range}`,
			schema.secret ? "" : current,
			value => {
				if (schema.secret && !value) {
					onCancel();
					return;
				}
				if (schema.type === "number" && !value.trim()) throw new Error("Enter a number.");
				onSubmit(value);
			},
			onCancel,
			{
				masked: schema.secret,
				purpose: schema.secret
					? "Replace secret draft · Empty keeps current value"
					: "Edit draft · Saved after combined review",
			},
		);
	}
}

// =============================================================================
// Main Plugin Settings Selector
// =============================================================================

export interface PluginSettingsCallbacks {
	getDraftSummary?: () => string[];
	onClose: () => void;
	onPluginChanged: () => void;
	onDraftChanged?: () => void;
}

/** Component with handleInput method */
interface InputHandler {
	handleInput(data: string): void;
}

/**
 * Top-level plugin settings component.
 * Manages navigation between plugin list and plugin detail views.
 */
export class PluginSettingsComponent extends Container {
	#manager: PluginManager;
	#snapshot: PluginSettingsSnapshot | null = null;
	#loadGeneration = 0;
	#listComponent: PluginListComponent | null = null;
	#loadError = "";
	override render(width: number): string[] {
		return (
			this.#viewComponent?.render(width) ??
			selectorFrame(
				width,
				process.stdout.rows || 24,
				"Plugin settings",
				"User defaults",
				[],
				[this.#loadError || "Loading plugin settings…"],
				[],
				this.#loadError ? ["Ctrl+R: retry · Esc: back"] : [],
			)
		);
	}
	get editing(): boolean {
		return this.#viewComponent instanceof PluginDetailComponent && this.#viewComponent.editing;
	}
	#viewComponent: (Container & InputHandler) | null = null;
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: state tracking for view management
	#currentView: "list" | "detail" = "list";
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: state tracking for view management
	#currentPlugin: InstalledPlugin | null = null;

	constructor(
		cwd: string,
		private readonly callbacks: PluginSettingsCallbacks,
		private readonly drafts: PluginSettingsDrafts = new PluginSettingsDrafts(),
		private readonly storage: PluginSettingsStorage = pluginSettingsStorage(cwd),
	) {
		super();
		this.#manager = new PluginManager(cwd);
		this.#showPluginList();
	}

	async #showPluginList(): Promise<void> {
		this.#loadError = "";
		const generation = ++this.#loadGeneration;
		this.#currentView = "list";
		this.#currentPlugin = null;
		this.clear();
		this.#viewComponent = null;
		this.addChild(new Text("Loading plugin settings…", 0, 0));

		try {
			const snapshot = await this.storage.load();
			if (generation !== this.#loadGeneration) return;
			this.#snapshot = snapshot;
			this.clear();
			const plugins = this.#snapshot.plugins.map(plugin => ({
				...plugin,
				enabled: this.drafts.value(this.#snapshot!, plugin, "enabled") as boolean,
				enabledFeatures: this.drafts.value(this.#snapshot!, plugin, "enabledFeatures") as string[] | null,
			}));

			if (this.#listComponent) this.#listComponent.updatePlugins(plugins);
			else
				this.#listComponent = new PluginListComponent(plugins, {
					getDraftSummary: this.callbacks.getDraftSummary,
					onPluginSelect: plugin => this.#showPluginDetail(plugin),
					onCancel: () => this.callbacks.onClose(),
				});
			this.#viewComponent = this.#listComponent;

			this.addChild(this.#viewComponent);
		} catch (error) {
			if (generation !== this.#loadGeneration) return;
			this.clear();
			this.#viewComponent = null;
			this.#loadError = `Plugin settings unavailable: ${error instanceof Error ? error.message : String(error)}`;
			this.addChild(
				new Text(
					`Plugin settings unavailable: ${error instanceof Error ? error.message : String(error)} · Ctrl+R: retry · Esc: back`,
					0,
					0,
				),
			);
		}
		this.callbacks.onDraftChanged?.();
	}

	#showPluginDetail(plugin: InstalledPlugin): void {
		++this.#loadGeneration;
		const snapshot = this.#snapshot;
		if (!snapshot) return;
		this.#currentView = "detail";
		this.#currentPlugin = plugin;
		this.clear();

		this.#viewComponent = new PluginDetailComponent(
			plugin,
			this.#manager,
			{
				getDraftSummary: this.callbacks.getDraftSummary,
				onEnabledChange: enabled => {
					this.drafts.stage(snapshot, plugin, "enabled", enabled);
					this.callbacks.onDraftChanged?.();
				},
				onFeatureChange: (feature, enabled) => {
					const saved = this.drafts.value(snapshot, plugin, "enabledFeatures") as string[] | null;
					const current = new Set(
						saved ??
							Object.entries(plugin.manifest.features ?? {})
								.filter(([, def]) => def.default)
								.map(([name]) => name),
					);
					if (enabled) {
						current.add(feature);
					} else {
						current.delete(feature);
					}
					this.drafts.stage(snapshot, plugin, "enabledFeatures", [...current]);
					this.callbacks.onDraftChanged?.();
				},
				onConfigChange: (key, value) => {
					this.drafts.stage(snapshot, plugin, `config:${key}`, value);
					this.callbacks.onDraftChanged?.();
				},
				onBack: () => this.#showPluginList(),
			},
			Object.fromEntries(
				Object.keys(plugin.manifest.settings ?? {}).map(key => [
					key,
					this.drafts.value(snapshot, plugin, `config:${key}`),
				]),
			),
		);

		this.addChild(this.#viewComponent);
	}

	handleInput(data: string): void {
		if (!this.#viewComponent && matchesSelectorKey(data, "cancel")) {
			++this.#loadGeneration;
			this.callbacks.onClose();
			return;
		}
		if (!this.#viewComponent && data === "\x12") {
			void this.#showPluginList();
			return;
		}
		this.#viewComponent?.handleInput(data);
	}
}
