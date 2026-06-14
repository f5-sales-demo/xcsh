import type { ApiSpecDomainResource, ApiSpecValidationResourceEntry } from "../internal-urls/api-spec-types";

export interface ResourceManifest {
	kind: string;
	metadata: {
		name: string;
		namespace?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
		description?: string;
		disable?: boolean;
	};
	spec: Record<string, unknown>;
	rawObject: Record<string, unknown>;
}

export interface ParsedResourceArgs {
	filenames: string[];
	namespace?: string;
	outputFormat: "json" | "yaml" | "table" | "wide";
	dryRun?: "client" | "server";
	recursive: boolean;
	force: boolean;
	kind?: string;
	name?: string;
}

export interface ResolvedKind {
	kind: string;
	domain: string;
	resource: ApiSpecDomainResource;
	paths: {
		list: string;
		get: string;
		create: string;
		update: string;
		delete: string;
	};
	validation?: ApiSpecValidationResourceEntry;
}

export type ValidationErrorCode = "MISSING_FIELD" | "UNKNOWN_KIND" | "INVALID_TYPE" | "PARSE_ERROR" | "DUPLICATE_NAME";

export type ValidationWarningCode = "EXTRA_FIELD" | "DEPRECATED_FIELD";

export interface ValidationError {
	path: string;
	message: string;
	code: ValidationErrorCode;
}

export interface ValidationWarning {
	path: string;
	message: string;
	code: ValidationWarningCode;
}

export interface ManifestValidationResult {
	valid: boolean;
	errors: ValidationError[];
	warnings: ValidationWarning[];
}

export interface DiffEntry {
	path: string;
	oldValue?: unknown;
	newValue?: unknown;
}

export interface ResourceDiff {
	hasDifferences: boolean;
	added: DiffEntry[];
	removed: DiffEntry[];
	changed: DiffEntry[];
	unchangedCount: number;
}

export type ResourceErrorKind = "validation" | "api" | "network" | "auth" | "conflict" | "not_found";

export interface ResourceError {
	kind: ResourceErrorKind;
	message: string;
	httpStatus?: number;
	manifestIndex?: number;
	resourceName?: string;
	resourceKind?: string;
}

export type OperationResult =
	| { status: "created"; resource: Record<string, unknown>; durationMs: number }
	| { status: "updated"; resource: Record<string, unknown>; diff: ResourceDiff; durationMs: number }
	| { status: "unchanged"; resource: Record<string, unknown> }
	| { status: "deleted"; name: string; kind: string; durationMs: number }
	| { status: "error"; error: ResourceError }
	| { status: "dry-run"; action: "create" | "update"; diff?: ResourceDiff };

export interface ResourceClientOptions {
	apiUrl: string;
	apiToken: string;
	namespace: string;
	dryRun?: "client" | "server";
	resolvePayloadVars?: (json: string) => string;
}
