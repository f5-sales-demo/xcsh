import { createKindResolver } from "@f5-sales-demo/pi-resource-management";
import { API_SPEC_INDEX, API_VALIDATION_DATA } from "../internal-urls/api-spec-index.generated";

export const kindResolver = createKindResolver(API_SPEC_INDEX, API_VALIDATION_DATA);

export type {
	ApiSpecDomainEntry,
	ApiSpecDomainResource,
	ApiSpecIndex,
	ApiSpecValidationResourceEntry,
	DiffEntry,
	KindResolver,
	ManifestValidationResult,
	OperationResult,
	ParsedResourceArgs,
	ResolvedKind,
	ResourceClientOptions,
	ResourceDiff,
	ResourceError,
	ResourceManifest,
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
	formatValidationErrors,
	KindResolutionError,
	ManifestFileError,
	ManifestParseError,
	parseManifests,
	parseResourceArgs,
	ResourceClient,
	readManifestFiles,
	validateManifest,
	validateManifests,
} from "@f5-sales-demo/pi-resource-management";
