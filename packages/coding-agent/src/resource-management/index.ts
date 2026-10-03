import {
	createKindResolver,
	type MapConstraints,
	type ValidationError,
	validateMapConstraints,
} from "@f5-sales-demo/pi-resource-management";
import { API_CATALOG_DATA } from "../internal-urls/api-catalog-index.generated";
import { API_SPEC_INDEX, API_VALIDATION_DATA } from "../internal-urls/api-spec-index.generated";

const baseResolver = createKindResolver(API_SPEC_INDEX, API_VALIDATION_DATA);
const normalizePath = (path: string) =>
	path.replace(/\{metadata\.namespace\}/g, "{namespace}").replace(/\{metadata\.name\}/g, "{name}");

function valuesAtPath(object: unknown, path: string): unknown[] {
	if (!path) return [object];
	const [part, ...remaining] = path.split(".");
	const name = part!.replace(/(?:\[\]|\{\})$/, "");
	if (!object || typeof object !== "object") return [];
	const child = (object as Record<string, unknown>)[name];
	if (child === undefined || child === null) return [];
	const rest = remaining.join(".");
	if (part!.endsWith("[]")) return Array.isArray(child) ? child.flatMap(item => valuesAtPath(item, rest)) : [];
	if (part!.endsWith("{}"))
		return typeof child === "object" ? Object.values(child).flatMap(item => valuesAtPath(item, rest)) : [];
	return valuesAtPath(child, rest);
}

export const kindResolver = {
	...baseResolver,
	resolveKind(kind: string) {
		const resolved = baseResolver.resolveKind(kind);
		return {
			...resolved,
			validateFields(object: Record<string, unknown>, operation: "create" | "update"): ValidationError[] {
				const method = operation === "update" ? "put" : "post";
				const errors: ValidationError[] = [];
				const seen = new Set<string>();
				for (const category of Object.values(API_CATALOG_DATA)) {
					for (const entry of category.operations) {
						if (entry.method.toLowerCase() !== method || normalizePath(entry.path) !== resolved.paths[operation])
							continue;
						for (const [field, metadata] of Object.entries(entry.fieldMetadata ?? {})) {
							if (metadata.constraints?.constraintType !== "map") continue;
							const fingerprint = `${field}:${JSON.stringify(metadata.constraints)}`;
							if (seen.has(fingerprint)) continue;
							seen.add(fingerprint);
							for (const value of valuesAtPath(object, field)) {
								for (const message of validateMapConstraints(
									value,
									metadata.constraints as unknown as MapConstraints,
								)) {
									errors.push({ path: field, message, code: "INVALID_MAP" });
								}
							}
						}
					}
				}
				return errors;
			},
		};
	},
};

export type {
	ApiSpecDomainEntry,
	ApiSpecDomainResource,
	ApiSpecIndex,
	ApiSpecValidationResourceEntry,
	DiffEntry,
	KindResolver,
	ManifestOperationInput,
	ManifestValidationResult,
	OperationResult,
	ParsedResourceArgs,
	ResolvedKind,
	ResourceClientOptions,
	ResourceDiff,
	ResourceError,
	ResourceManifest,
	ResourceOperation,
	ResourceOperationCounts,
	ResourceOperationItem,
	ResourceOperationReport,
	ValidationError,
	ValidationWarning,
} from "@f5-sales-demo/pi-resource-management";
export {
	computeResourceDiff,
	createKindResolver,
	formatDiff,
	formatMultiOperationSummary,
	formatOperationResult,
	formatResourceDetail,
	formatResourceList,
	formatResourceOperationReport,
	formatValidationErrors,
	KindResolutionError,
	ManifestFileError,
	ManifestParseError,
	parseManifests,
	parseResourceArgs,
	ResourceClient,
	readManifestFiles,
	readManifestInputs,
	runResourceOperation,
	validateManifest,
	validateManifests,
} from "@f5-sales-demo/pi-resource-management";
