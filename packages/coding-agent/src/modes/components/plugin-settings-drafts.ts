import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getPluginsLockfile, isEnoent } from "@f5-sales-demo/pi-utils";
import { PluginManager } from "../../extensibility/plugins/manager";
import type { InstalledPlugin, PluginRuntimeConfig } from "../../extensibility/plugins/types";

export interface PluginSettingsSnapshot {
	plugins: InstalledPlugin[];
	config: PluginRuntimeConfig;
	destination: string;
}

export interface PluginSettingsStorage {
	load(): Promise<PluginSettingsSnapshot>;
	write(next: PluginSettingsSnapshot, reviewed: PluginSettingsSnapshot): Promise<void>;
}

async function readConfig(destination: string): Promise<PluginRuntimeConfig> {
	try {
		const config = await Bun.file(destination).json();
		if (
			!config ||
			typeof config.plugins !== "object" ||
			!config.plugins ||
			Array.isArray(config.plugins) ||
			typeof config.settings !== "object" ||
			!config.settings ||
			Array.isArray(config.settings)
		)
			throw new Error("Invalid plugin settings file; repair it before saving.");
		return config;
	} catch (error) {
		if (isEnoent(error)) return { plugins: {}, settings: {} };
		throw error;
	}
}

export function pluginSettingsStorage(
	cwd: string,
	isolated?: { destination: string; list: () => Promise<InstalledPlugin[]> },
): PluginSettingsStorage {
	const destinationPath = () => isolated?.destination ?? getPluginsLockfile();
	return {
		load: async () => {
			const destination = destinationPath();
			const config = await readConfig(destination);
			return { destination, config, plugins: await (isolated?.list() ?? new PluginManager(cwd).list()) };
		},
		write: async (next, reviewed) => {
			if (next.destination !== destinationPath() || next.destination !== reviewed.destination)
				throw new Error("Plugin settings destination changed; review again.");
			if (!isDeepStrictEqual(await readConfig(next.destination), reviewed.config))
				throw new Error("Plugin settings changed while saving; review again.");
			await mkdir(dirname(next.destination), { recursive: true });
			const temporary = `${next.destination}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporary, JSON.stringify(next.config, null, 2), { mode: 0o600, flag: "wx" });
				await rename(temporary, next.destination);
			} finally {
				await rm(temporary, { force: true });
			}
		},
	};
}

export type PluginDraftField = "enabled" | "enabledFeatures" | `config:${string}`;

interface PluginDraft {
	plugin: InstalledPlugin;
	destination: string;
	field: PluginDraftField;
	before: unknown;
	after: unknown;
	secret: boolean;
}

function savedValue(snapshot: PluginSettingsSnapshot, plugin: InstalledPlugin, field: PluginDraftField): unknown {
	if (field === "enabled") return snapshot.config.plugins[plugin.name]?.enabled ?? true;
	if (field === "enabledFeatures") return snapshot.config.plugins[plugin.name]?.enabledFeatures ?? null;
	const key = field.slice(7);
	return snapshot.config.settings[plugin.name]?.[key] ?? plugin.manifest.settings?.[key]?.default;
}

/** Drafts describe user defaults, never values merged with project overrides. */
export class PluginSettingsDrafts {
	#drafts = new Map<string, PluginDraft>();
	#saving = false;
	get size(): number {
		return this.#drafts.size;
	}
	#key(plugin: InstalledPlugin, field: PluginDraftField): string {
		return JSON.stringify([plugin.path, plugin.name, field]);
	}
	value(snapshot: PluginSettingsSnapshot, plugin: InstalledPlugin, field: PluginDraftField): unknown {
		const draft = this.#drafts.get(this.#key(plugin, field));
		return draft ? draft.after : savedValue(snapshot, plugin, field);
	}
	stage(snapshot: PluginSettingsSnapshot, plugin: InstalledPlugin, field: PluginDraftField, after: unknown): void {
		if (this.#saving) throw new Error("Plugin settings save is in progress.");
		if (field === "enabled" && typeof after !== "boolean") throw new Error("Enabled must be boolean.");
		if (field === "enabledFeatures" && after !== null) {
			if (
				!Array.isArray(after) ||
				after.some(feature => typeof feature !== "string" || !plugin.manifest.features?.[feature])
			)
				throw new Error("Unknown plugin feature.");
			after = [...new Set(after)].sort();
		}
		const schema = field.startsWith("config:") ? plugin.manifest.settings?.[field.slice(7)] : undefined;
		if (field.startsWith("config:") && !schema) throw new Error("Unknown plugin setting.");
		if (schema) {
			if (schema.type === "enum") {
				if (typeof after !== "string" || !schema.values.includes(after))
					throw new Error("Choose a declared setting value.");
			} else if (typeof after !== schema.type) throw new Error(`Setting requires ${schema.type}.`);
			if (
				schema.type === "number" &&
				(typeof after !== "number" ||
					!Number.isFinite(after) ||
					(schema.min !== undefined && after < schema.min) ||
					(schema.max !== undefined && after > schema.max))
			)
				throw new Error("Setting is outside its numeric range.");
		}
		const key = this.#key(plugin, field);
		const existing = this.#drafts.get(key);
		const before = existing ? existing.before : savedValue(snapshot, plugin, field);
		if (isDeepStrictEqual(before, after)) this.#drafts.delete(key);
		else
			this.#drafts.set(key, {
				plugin: structuredClone(plugin),
				destination: snapshot.destination,
				field,
				before: structuredClone(before),
				after: structuredClone(after),
				secret: Boolean(schema?.secret),
			});
	}
	clear(): void {
		if (this.#saving) throw new Error("Plugin settings save is in progress.");
		this.#drafts.clear();
	}
	reviewLines(): string[] {
		return [...this.#drafts.values()].map(draft => {
			const changes = draft.secret
				? "[masked] → [masked]"
				: `${JSON.stringify(draft.before)} → ${JSON.stringify(draft.after)}`;
			return `${draft.plugin.name}@${draft.plugin.version} · ${draft.plugin.path} · User defaults → ${draft.destination} · ${draft.field}: ${changes} · Project overrides may remain effective; loaded plugins may require reload.`;
		});
	}
	validate(snapshot: PluginSettingsSnapshot): void {
		for (const draft of this.#drafts.values()) {
			const plugin = snapshot.plugins.find(
				plugin => plugin.name === draft.plugin.name && plugin.path === draft.plugin.path,
			);
			if (
				!plugin ||
				plugin.version !== draft.plugin.version ||
				!isDeepStrictEqual(plugin.manifest, draft.plugin.manifest) ||
				snapshot.destination !== draft.destination
			)
				throw new Error(`Plugin target changed: ${draft.plugin.name}. Reopen and review its settings.`);
			const current = savedValue(snapshot, plugin, draft.field);
			if (!isDeepStrictEqual(current, draft.before) && !isDeepStrictEqual(current, draft.after))
				throw new Error(
					`Saved plugin value changed: ${plugin.name} ${draft.field}. Reopen and review its settings.`,
				);
		}
	}
	async save(
		load: () => Promise<PluginSettingsSnapshot>,
		write: (snapshot: PluginSettingsSnapshot, reviewed: PluginSettingsSnapshot) => Promise<void>,
	): Promise<void> {
		if (this.#saving) throw new Error("Plugin settings save is already in progress.");
		if (!this.#drafts.size) return;
		this.#saving = true;
		try {
			const snapshot = await load();
			this.validate(snapshot);
			const next = structuredClone(snapshot);
			let changed = false;
			for (const draft of this.#drafts.values()) {
				if (isDeepStrictEqual(savedValue(snapshot, draft.plugin, draft.field), draft.after)) continue;
				changed = true;
				const name = draft.plugin.name;
				if (draft.field.startsWith("config:")) {
					next.config.settings[name] ??= {};
					next.config.settings[name][draft.field.slice(7)] = structuredClone(draft.after);
				} else {
					next.config.plugins[name] ??= { version: draft.plugin.version, enabled: true, enabledFeatures: null };
					if (draft.field === "enabled") next.config.plugins[name].enabled = draft.after as boolean;
					else next.config.plugins[name].enabledFeatures = draft.after as string[] | null;
				}
			}
			if (changed) await write(next, snapshot);
			this.#drafts.clear();
		} finally {
			this.#saving = false;
		}
	}
}
