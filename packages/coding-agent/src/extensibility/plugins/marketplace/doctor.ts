import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { DoctorCheck } from "../types";
import { parseMarketplaceCatalog } from "./fetcher";
import { assertRuntimeRequirement } from "./runtime";
import type { InstalledPluginEntry, MarketplaceCatalog, MarketplaceRegistryEntry } from "./types";
import { isInstalledPluginEffectivelyEnabled, isValidNameSegment, parsePluginId } from "./types";

export interface MarketplaceDoctorOptions {
	marketplacesRegistryPath: string;
	userRegistryPath: string;
	projectRegistryPath?: string;
	scope?: "user" | "project";
}
type Json = Record<string, unknown>;
type Installed = { id: string; scope: "user" | "project"; entry: InstalledPluginEntry };
const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/** Inspect cached installation data only. No registry migration, source execution,
 * catalog refresh, environment setup or automatic repair occurs here.
 */
export async function inspectMarketplacePlugins(options: MarketplaceDoctorOptions) {
	const checks: DoctorCheck[] = [];
	const add = (name: string, status: DoctorCheck["status"], message: string) => checks.push({ name, status, message });
	const read = async (file: string, name: string): Promise<Json | undefined> => {
		try {
			const value: unknown = JSON.parse(await readFile(file, "utf8"));
			if (!object(value)) throw new Error("JSON object required");
			return value;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				add(name, "error", "Registry is unreadable or malformed");
			return undefined;
		}
	};
	const installed: Installed[] = [];
	const registries = [
		{ scope: "user" as const, path: options.userRegistryPath },
		...(options.projectRegistryPath ? [{ scope: "project" as const, path: options.projectRegistryPath }] : []),
	];
	for (const registry of registries) {
		if (options.scope === "user" && registry.scope === "project") continue;
		const name = `marketplace_registry:${registry.scope}`;
		const data = await read(registry.path, name);
		if (!data) continue;
		if (!Number.isSafeInteger(data.version) || (data.version as number) < 1 || !object(data.plugins)) {
			add(name, "error", "Installed registry version or plugin map is invalid");
			continue;
		}
		for (const [id, entries] of Object.entries(data.plugins)) {
			if (!parsePluginId(id) || !Array.isArray(entries) || entries.length === 0) {
				add(name, "error", "Installed plugin identity or entries are invalid");
				continue;
			}
			for (const entry of entries) {
				if (
					!object(entry) ||
					!(entry.scope === registry.scope || (registry.scope === "project" && entry.scope === "local")) ||
					typeof entry.installPath !== "string" ||
					!isAbsolute(entry.installPath) ||
					typeof entry.version !== "string" ||
					!entry.version ||
					!instant(entry.installedAt) ||
					!instant(entry.lastUpdated) ||
					(entry.enabled !== undefined && typeof entry.enabled !== "boolean") ||
					(entry.enabledAt !== undefined && !instant(entry.enabledAt))
				) {
					add(name, "error", "Installed plugin scope, path, version or state is invalid");
					continue;
				}
				installed.push({ id, scope: registry.scope, entry: entry as unknown as InstalledPluginEntry });
			}
		}
	}
	const selected = installed.filter(row => !options.scope || row.scope === options.scope);
	const marketplaces = new Map<string, MarketplaceRegistryEntry>();
	const registry = await read(options.marketplacesRegistryPath, "marketplace_catalog_registry");
	if (registry) {
		if (
			!Number.isSafeInteger(registry.version) ||
			![1, 2].includes(registry.version as number) ||
			!Array.isArray(registry.marketplaces)
		) {
			add("marketplace_catalog_registry", "error", "Marketplace registry version or entries are invalid");
		} else
			for (const value of registry.marketplaces) {
				if (
					!object(value) ||
					typeof value.name !== "string" ||
					!isValidNameSegment(value.name) ||
					typeof value.catalogPath !== "string" ||
					!isAbsolute(value.catalogPath) ||
					(value.enabled !== undefined && typeof value.enabled !== "boolean") ||
					(value.pluginsDisabledAt !== undefined && !instant(value.pluginsDisabledAt)) ||
					marketplaces.has(value.name)
				) {
					add("marketplace_catalog_registry", "error", "Marketplace identity, catalog path or state is invalid");
					continue;
				}
				marketplaces.set(value.name, value as unknown as MarketplaceRegistryEntry);
			}
	}
	const catalogs = new Map<string, MarketplaceCatalog | null>();
	const preferredDependencies = (row: Installed, id: string) => {
		const eligible = installed.filter(item => item.id === id && (row.scope === "project" || item.scope === "user"));
		return eligible.some(item => item.scope === "project")
			? eligible.filter(item => item.scope === "project")
			: eligible;
	};
	const dependencyUsable = async (row: Installed, trail: ReadonlySet<string>): Promise<boolean> => {
		const key = `${row.scope}:${row.id}`;
		const identity = parsePluginId(row.id)!;
		if (trail.has(key) || !isInstalledPluginEffectivelyEnabled(row.entry, marketplaces.get(identity.marketplace)))
			return false;
		const next = new Set([...trail, key]);
		try {
			const root = await realpath(row.entry.installPath);
			if (!(await stat(root)).isDirectory()) return false;
			const manifest: unknown = JSON.parse(await readFile(resolve(root, ".xcsh-plugin/plugin.json"), "utf8"));
			if (
				!object(manifest) ||
				manifest.name !== identity.name ||
				manifest.version !== row.entry.version.split("+")[0]
			)
				return false;
			assertRuntimeRequirement({
				name: identity.name,
				minimumRuntimeVersion: manifest.minimumRuntimeVersion as string | undefined,
			});
			for (const field of ["extensions", "commands", "skills", "agents", "hooks", "lspServers", "mcpServers"]) {
				const value = manifest[field];
				if (value === undefined || (["hooks", "lspServers", "mcpServers"].includes(field) && object(value)))
					continue;
				const entries = typeof value === "string" ? [value] : value;
				if (!Array.isArray(entries) || entries.some(entry => typeof entry !== "string" || !entry)) return false;
				for (const entry of entries as string[]) {
					if (isAbsolute(entry)) return false;
					const target = await realpath(resolve(root, entry));
					const rel = relative(root, target),
						info = await stat(target);
					if (
						rel === ".." ||
						rel.startsWith(`..${sep}`) ||
						isAbsolute(rel) ||
						!(field === "extensions" ? info.isFile() : info.isFile() || info.isDirectory())
					)
						return false;
				}
			}
			let lifecycle = manifest.lifecycle;
			if (lifecycle === undefined) {
				const candidate = catalogs.get(identity.marketplace)?.plugins.find(plugin => plugin.name === identity.name);
				if (candidate && candidate.version === manifest.version) lifecycle = candidate.lifecycle;
			}
			if (
				!object(lifecycle) ||
				!Array.isArray(lifecycle.pluginDependencies) ||
				lifecycle.pluginDependencies.some(value => typeof value !== "string" || !isValidNameSegment(value))
			)
				return false;
			for (const dependency of lifecycle.pluginDependencies as string[]) {
				let available = false;
				for (const candidate of preferredDependencies(row, `${dependency}@${identity.marketplace}`))
					if (await dependencyUsable(candidate, next)) {
						available = true;
						break;
					}
				if (!available) return false;
			}
			return true;
		} catch {
			return false;
		}
	};

	for (const row of selected) {
		const identity = parsePluginId(row.id)!;
		const name = `marketplace:${row.scope}:${row.id}`;
		const marketplace = marketplaces.get(identity.marketplace);
		if (!marketplace) add(`${name}:catalog`, "error", "Installed plugin marketplace is not registered");
		else if (!catalogs.has(identity.marketplace)) {
			try {
				const catalog = parseMarketplaceCatalog(
					await readFile(marketplace.catalogPath, "utf8"),
					marketplace.catalogPath,
				);
				if (catalog.name !== identity.marketplace) throw new Error("Catalog identity differs");
				catalogs.set(identity.marketplace, catalog);
			} catch {
				catalogs.set(identity.marketplace, null);
			}
		}
		if (marketplace && !catalogs.get(identity.marketplace))
			add(`${name}:catalog`, "error", "Cached catalog is missing or malformed");
		let root: string;
		try {
			if (!(await stat(row.entry.installPath)).isDirectory()) throw new Error("Directory required");
			root = await realpath(row.entry.installPath);
			add(`${name}:source`, "ok", `Installed ${row.scope} source at ${row.entry.installPath}`);
		} catch {
			add(`${name}:source`, "error", "Installed plugin source directory is missing or unreadable");
			continue;
		}
		let manifest: Json;
		try {
			const value: unknown = JSON.parse(await readFile(resolve(root, ".xcsh-plugin/plugin.json"), "utf8"));
			if (
				!object(value) ||
				value.name !== identity.name ||
				typeof value.version !== "string" ||
				value.version !== row.entry.version.split("+")[0]
			)
				throw new Error("Manifest identity differs");
			manifest = value;
			add(`${name}:manifest`, "ok", `v${row.entry.version}`);
		} catch {
			add(
				`${name}:manifest`,
				"error",
				"Installed manifest is missing, malformed or has a different identity/version",
			);
			continue;
		}
		try {
			assertRuntimeRequirement({
				name: identity.name,
				minimumRuntimeVersion: manifest.minimumRuntimeVersion as string | undefined,
			});
		} catch {
			add(`${name}:runtime`, "error", "Installed plugin requires a different or invalid runtime version");
		}
		for (const field of ["extensions", "commands", "skills", "agents", "hooks", "lspServers", "mcpServers"]) {
			const value = manifest[field];
			if (
				value === undefined ||
				((field === "hooks" || field === "lspServers" || field === "mcpServers") && object(value))
			)
				continue;
			const entries = typeof value === "string" ? [value] : value;
			if (!Array.isArray(entries) || entries.some(entry => typeof entry !== "string" || !entry)) {
				add(`${name}:entrypoint:${field}`, "error", "Declared entrypoint list is malformed");
				continue;
			}
			for (const entry of entries as string[]) {
				try {
					if (isAbsolute(entry)) throw new Error("Relative entrypoint required");
					const target = await realpath(resolve(root, entry));
					const rel = relative(root, target);
					if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
						throw new Error("Entrypoint outside source");
					const info = await stat(target);
					if (!(field === "extensions" ? info.isFile() : info.isFile() || info.isDirectory()))
						throw new Error("Entrypoint type differs");
					add(`${name}:entrypoint:${field}:${entry}`, "ok", "Declared entrypoint exists within installed source");
				} catch {
					add(
						`${name}:entrypoint:${field}:${entry}`,
						"error",
						"Declared entrypoint is missing, unreadable or outside installed source",
					);
				}
			}
		}
		let lifecycle = manifest.lifecycle;
		if (lifecycle === undefined) {
			const candidate = catalogs.get(identity.marketplace)?.plugins.find(plugin => plugin.name === identity.name);
			if (candidate && candidate.version === manifest.version) lifecycle = candidate.lifecycle;
		}
		if (
			!object(lifecycle) ||
			!Array.isArray(lifecycle.pluginDependencies) ||
			lifecycle.pluginDependencies.some(value => typeof value !== "string" || !isValidNameSegment(value))
		) {
			add(`${name}:dependencies`, "error", "Installed dependency metadata is unavailable or malformed");
			continue;
		}
		if (!isInstalledPluginEffectivelyEnabled(row.entry, marketplace)) continue;
		for (const dependency of lifecycle.pluginDependencies as string[]) {
			const id = `${dependency}@${identity.marketplace}`;
			const eligible = installed.filter(
				item => item.id === id && (row.scope === "project" || item.scope === "user"),
			);
			const preferred = eligible.some(item => item.scope === "project")
				? eligible.filter(item => item.scope === "project")
				: eligible;
			let available = false;
			for (const candidate of preferred)
				if (await dependencyUsable(candidate, new Set([`${row.scope}:${row.id}`]))) {
					available = true;
					break;
				}
			if (!available)
				add(
					`${name}:dependency:${dependency}`,
					"error",
					"Required dependency is missing, disabled, cyclic or invalid in the effective scope",
				);
			else
				add(
					`${name}:dependency:${dependency}`,
					"ok",
					"Required dependency is installed and enabled in the effective scope",
				);
		}
	}
	return { checks, hasInstallations: selected.length > 0 };
}
