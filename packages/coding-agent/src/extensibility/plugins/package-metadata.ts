import type { PluginManifest, PluginRuntimeConfig, ProjectPluginOverrides } from "./types";

export interface PluginPackageMetadata {
	name: string;
	version: string;
	description?: string;
	xcsh?: PluginManifest;
	pi?: PluginManifest;
}

const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === "string" && item.length > 0);
}

/** Validate package identity and the manifest fields consumed by discovery. */
export function validatePluginPackage(value: unknown, expectedName?: string): PluginPackageMetadata {
	if (!isRecord(value) || typeof value.name !== "string" || !PACKAGE_NAME.test(value.name))
		throw new Error("Plugin package.json must contain a valid package name");
	if (expectedName !== undefined && value.name !== expectedName)
		throw new Error("Plugin package identity does not match its registered name");
	if (typeof value.version !== "string" || !value.version.trim())
		throw new Error("Plugin package.json must contain a version string");
	for (const key of ["xcsh", "pi"]) {
		const manifest = value[key];
		if (manifest === undefined) continue;
		if (!isRecord(manifest)) throw new Error(`Invalid ${key} plugin manifest`);
		for (const entry of ["tools", "hooks"]) {
			if (manifest[entry] !== undefined && (typeof manifest[entry] !== "string" || !manifest[entry]))
				throw new Error(`Invalid ${key}.${entry} plugin entry`);
		}
		for (const entry of ["extensions", "commands"]) {
			if (manifest[entry] !== undefined && !isStringArray(manifest[entry]))
				throw new Error(`Invalid ${key}.${entry} plugin entries`);
		}
		if (manifest.features !== undefined) {
			if (!isRecord(manifest.features)) throw new Error(`Invalid ${key}.features plugin manifest`);
			for (const feature of Object.values(manifest.features)) {
				if (!isRecord(feature)) throw new Error(`Invalid ${key} plugin feature`);
				if (feature.default !== undefined && typeof feature.default !== "boolean")
					throw new Error(`Invalid ${key} plugin feature default`);
				for (const entry of ["tools", "hooks", "extensions", "commands"]) {
					if (feature[entry] !== undefined && !isStringArray(feature[entry]))
						throw new Error(`Invalid ${key} plugin feature entries`);
				}
			}
		}
		if (manifest.settings !== undefined) {
			if (!isRecord(manifest.settings)) throw new Error(`Invalid ${key} plugin settings schema`);
			for (const schema of Object.values(manifest.settings)) {
				if (
					!isRecord(schema) ||
					typeof schema.type !== "string" ||
					!["string", "number", "boolean", "enum"].includes(schema.type)
				)
					throw new Error(`Invalid ${key} plugin setting type`);
				if (schema.type === "enum" && !isStringArray(schema.values))
					throw new Error(`Invalid ${key} plugin setting choices`);
				const defaultType = schema.type === "enum" ? "string" : schema.type;
				if (schema.default !== undefined && typeof schema.default !== defaultType)
					throw new Error(`Invalid ${key} plugin setting default`);
				if (schema.secret !== undefined && typeof schema.secret !== "boolean")
					throw new Error(`Invalid ${key} plugin setting secrecy`);
				for (const field of ["description", "env"]) {
					if (schema[field] !== undefined && typeof schema[field] !== "string")
						throw new Error(`Invalid ${key} plugin setting metadata`);
				}
				if (schema.type === "number") {
					for (const field of ["default", "min", "max", "step"]) {
						if (
							schema[field] !== undefined &&
							(typeof schema[field] !== "number" || !Number.isFinite(schema[field]))
						)
							throw new Error(`Invalid ${key} plugin numeric setting`);
					}
				}
			}
		}
	}
	return value as unknown as PluginPackageMetadata;
}

/** Validate registry keys before resolving filesystem paths. */
export function validatePluginRegistry(value: unknown): { dependencies?: Record<string, string> } {
	if (!isRecord(value)) throw new Error("Invalid plugin dependency registry");
	if (value.dependencies !== undefined) {
		if (!isRecord(value.dependencies)) throw new Error("Invalid plugin dependency registry");
		for (const [name, spec] of Object.entries(value.dependencies)) {
			if (!PACKAGE_NAME.test(name) || typeof spec !== "string" || !spec)
				throw new Error("Invalid registered plugin dependency");
		}
	}
	return value as { dependencies?: Record<string, string> };
}

/** Malformed persisted state must not become a successful default or overwrite. */
export function validatePluginRuntimeConfig(value: unknown): PluginRuntimeConfig {
	if (!isRecord(value) || !isRecord(value.plugins) || !isRecord(value.settings))
		throw new Error("Invalid plugin runtime configuration");
	for (const [name, state] of Object.entries(value.plugins)) {
		if (
			!PACKAGE_NAME.test(name) ||
			!isRecord(state) ||
			typeof state.version !== "string" ||
			typeof state.enabled !== "boolean" ||
			(state.enabledFeatures !== null && !isStringArray(state.enabledFeatures))
		)
			throw new Error("Invalid plugin runtime state");
	}
	if (!Object.values(value.settings).every(isRecord)) throw new Error("Invalid plugin settings");
	return value as unknown as PluginRuntimeConfig;
}

/** Validate project controls before deriving effective enabled state or settings. */
export function validateProjectPluginOverrides(value: unknown): ProjectPluginOverrides {
	if (!isRecord(value)) throw new Error("Invalid project plugin overrides");
	if (
		value.disabled !== undefined &&
		(!isStringArray(value.disabled) || !value.disabled.every(name => PACKAGE_NAME.test(name)))
	)
		throw new Error("Invalid disabled project plugins");
	if (value.features !== undefined) {
		if (!isRecord(value.features)) throw new Error("Invalid project plugin features");
		for (const [name, features] of Object.entries(value.features)) {
			if (!PACKAGE_NAME.test(name) || !isStringArray(features)) throw new Error("Invalid project plugin features");
		}
	}
	if (value.settings !== undefined && (!isRecord(value.settings) || !Object.values(value.settings).every(isRecord)))
		throw new Error("Invalid project plugin settings");
	return value as ProjectPluginOverrides;
}
