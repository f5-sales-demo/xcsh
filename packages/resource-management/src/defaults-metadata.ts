import { DEFAULTS_METADATA } from "./defaults-metadata.generated";
import type { MinimalExportFilter } from "./manifest-export";

/**
 * Raw, per-kind defaults knowledge extracted from the enriched API specs
 * (the api-specs-enriched single source of truth). Field paths are
 * `spec.`-prefixed, matching the enriched OpenAPI schema paths.
 *
 * This is the input to {@link buildFilterFromMetadata}, which transforms it
 * into the spec-relative {@link MinimalExportFilter} consumed by
 * {@link applyMinimalExportFilter}.
 */
export interface KindDefaultsMetadata {
	/** Field paths the server applies a default for (from `x-f5xc-server-default`). */
	readonly serverDefaultFields: readonly string[];
	/** Known default values, keyed by field path (from OpenAPI `default`). */
	readonly fieldDefaults: Readonly<Record<string, unknown>>;
	/** Field paths required for a minimum viable config (never stripped). */
	readonly minimumConfigFields: readonly string[];
	/** oneOf conflicts, keyed by field path (from `x-f5xc-conflicts-with`). */
	readonly fieldConflicts: Readonly<Record<string, readonly string[]>>;
}

function stripSpecPrefix(path: string): string {
	return path.startsWith("spec.") ? path.slice(5) : path;
}

/**
 * Transform raw per-kind defaults knowledge into a {@link MinimalExportFilter}.
 *
 * Returns `undefined` when the kind has no server-default fields — callers
 * treat that as "export everything" (no stripping), which is the safe default
 * for kinds not yet covered by the enriched specs.
 */
export function buildFilterFromMetadata(meta: KindDefaultsMetadata): MinimalExportFilter | undefined {
	if (meta.serverDefaultFields.length === 0) {
		return undefined;
	}

	const serverDefaults: Record<string, unknown> = {};
	const serverDefaultFields: string[] = [];

	for (const path of meta.serverDefaultFields) {
		const specPath = stripSpecPrefix(path);
		if (path in meta.fieldDefaults) {
			serverDefaults[specPath] = meta.fieldDefaults[path];
		} else {
			serverDefaultFields.push(specPath);
		}
	}

	const oneofDefaultVariants: Record<string, string> = {};
	for (const [path, conflictList] of Object.entries(meta.fieldConflicts)) {
		if (!meta.serverDefaultFields.includes(path)) continue;
		if (conflictList.length === 0) continue;
		const fieldName = stripSpecPrefix(path).split(".").pop();
		if (fieldName) {
			oneofDefaultVariants[fieldName] = fieldName;
		}
	}

	const minimumConfigFields = meta.minimumConfigFields.map(stripSpecPrefix);

	return { serverDefaults, serverDefaultFields, minimumConfigFields, oneofDefaultVariants };
}

/**
 * Build the minimum-settings export filter for a resource kind from the
 * generated defaults table. Returns `undefined` for kinds with no known
 * server defaults (caller exports everything).
 */
export function buildMinimalExportFilter(kind: string): MinimalExportFilter | undefined {
	const meta = DEFAULTS_METADATA[kind];
	if (!meta) return undefined;
	return buildFilterFromMetadata(meta);
}
