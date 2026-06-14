export { parseResourceArgs } from "./arg-parser";
export { computeResourceDiff, formatDiff } from "./diff-engine";
export { ManifestFileError, readManifestFiles } from "./file-reader";
export { createKindResolver, KindResolutionError } from "./kind-resolver";
export { ManifestParseError, parseManifests } from "./manifest-parser";
export { formatValidationErrors, validateManifest, validateManifests } from "./manifest-validator";
export {
	formatMultiOperationSummary,
	formatOperationResult,
	formatResourceDetail,
	formatResourceList,
} from "./output-formatter";
export { ResourceClient } from "./resource-client";
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
	ResourceErrorKind,
	ResourceManifest,
	ValidationError,
	ValidationErrorCode,
	ValidationWarning,
	ValidationWarningCode,
} from "./types";
