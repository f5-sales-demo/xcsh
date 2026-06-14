import { KindResolutionError } from "./kind-resolver";
import type {
	KindResolver,
	ManifestValidationResult,
	ResolvedKind,
	ResourceManifest,
	ValidationError,
	ValidationWarning,
} from "./types";

export function validateManifest(
	manifest: ResourceManifest,
	resolver: KindResolver,
	namespaceOverride?: string,
): { result: ManifestValidationResult; resolved?: ResolvedKind } {
	const errors: ValidationError[] = [];
	const warnings: ValidationWarning[] = [];

	if (!manifest.kind) {
		errors.push({ path: "kind", message: 'Required field "kind" is missing.', code: "MISSING_FIELD" });
	}

	if (!manifest.metadata.name) {
		errors.push({
			path: "metadata.name",
			message: 'Required field "metadata.name" is missing.',
			code: "MISSING_FIELD",
		});
	}

	if (!manifest.metadata.namespace && !namespaceOverride) {
		errors.push({
			path: "metadata.namespace",
			message: "No namespace specified. Use -n flag or set metadata.namespace in the manifest.",
			code: "MISSING_FIELD",
		});
	}

	let resolved: ResolvedKind | undefined;
	if (manifest.kind) {
		try {
			resolved = resolver.resolveKind(manifest.kind);
		} catch (err) {
			if (err instanceof KindResolutionError) {
				errors.push({ path: "kind", message: err.message, code: "UNKNOWN_KIND" });
			} else {
				errors.push({
					path: "kind",
					message: `Failed to resolve kind "${manifest.kind}": ${(err as Error).message}`,
					code: "UNKNOWN_KIND",
				});
			}
		}
	}

	if (resolved?.validation) {
		const requiredFields = resolved.validation.create ?? resolved.validation.minimum_config ?? [];
		for (const fieldPath of requiredFields) {
			if (fieldPath.startsWith("metadata.")) continue;
			const value = getNestedValue(manifest.rawObject, fieldPath);
			if (value === undefined || value === null) {
				errors.push({
					path: fieldPath,
					message: `Required field "${fieldPath}" is missing for ${manifest.kind} creation.`,
					code: "MISSING_FIELD",
				});
			}
		}
	}

	return { result: { valid: errors.length === 0, errors, warnings }, resolved };
}

export function validateManifests(
	manifests: ResourceManifest[],
	resolver: KindResolver,
	namespaceOverride?: string,
): { results: ManifestValidationResult[]; resolved: (ResolvedKind | undefined)[] } {
	const results: ManifestValidationResult[] = [];
	const resolved: (ResolvedKind | undefined)[] = [];
	for (const manifest of manifests) {
		const v = validateManifest(manifest, resolver, namespaceOverride);
		results.push(v.result);
		resolved.push(v.resolved);
	}
	return { results, resolved };
}

export function formatValidationErrors(manifest: ResourceManifest, result: ManifestValidationResult): string {
	const lines: string[] = [];
	lines.push(`Error: validation failed for ${manifest.kind || "unknown"} "${manifest.metadata.name || "unnamed"}"`);
	for (const error of result.errors) {
		lines.push(`  - ${error.path}: ${error.message}`);
	}
	for (const warning of result.warnings) {
		lines.push(`  ! ${warning.path}: ${warning.message}`);
	}
	return lines.join("\n");
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}
