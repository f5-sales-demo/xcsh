import type {
	ApiSpecIndex,
	ApiSpecValidationResourceEntry,
	HttpTransport,
	ManifestValidationResult,
	OpenAPISpec,
	ResourceDiff,
	ResourceOperationReport,
	ValidationCatalogCategory,
} from "@f5-sales-demo/pi-resource-management";

export interface ContextSnapshot {
	readonly active: boolean;
	readonly workspaceId: string;
	readonly contextId: string;
	/** Host-owned monotonic revision, including credential and environment changes. */
	readonly revision: string;
	readonly apiUrl: string;
	readonly namespace: string;
}
export interface Binding {
	readonly id: string;
}
export type MutationOperation = "apply" | "create" | "update" | "delete";
export interface PlanEntry {
	readonly kind: string;
	readonly name: string;
	readonly namespace: string;
	readonly action: "create" | "update" | "delete" | "unchanged";
	readonly changes?: ResourceDiff;
}
export interface ValidatedPlan {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly hash: string;
	readonly binding: string;
	readonly specificationHash: string;
	readonly operation: MutationOperation;
	readonly entries: readonly PlanEntry[];
}
export interface CoreReceipt {
	readonly schemaVersion: 1;
	readonly planId: string;
	readonly planHash: string;
	readonly binding: string;
	readonly stage: "prepared" | "authorized" | "dispatching" | "verified" | "complete" | "failed" | "uncertain";
	readonly completed: number;
	readonly code?: string;
}
export interface CoreHost {
	getContext(signal?: AbortSignal): ContextSnapshot;
	getCredentials(snapshot: ContextSnapshot, signal?: AbortSignal): Promise<{ apiToken: string }>;
	approve(plan: ValidatedPlan, signal?: AbortSignal): Promise<{ approved: boolean; planHash: string }>;
	/** Persist atomically to host-owned private storage. Failure prevents dispatch. */
	persist(receipt: CoreReceipt): Promise<void>;
	/** Test or host transport adapter. Production defaults to a single-attempt Node fetch. */
	readonly transport?: HttpTransport;
}
export interface SpecificationData {
	readonly version: string;
	readonly index: ApiSpecIndex;
	readonly validation: Readonly<Record<string, ApiSpecValidationResourceEntry>>;
	readonly catalog: Readonly<Record<string, ValidationCatalogCategory>>;
	readonly specs: Readonly<Record<string, OpenAPISpec>>;
}
export interface CoreCapabilities {
	readonly protocol: "xcsh-f5-core";
	readonly version: 1;
	readonly specificationVersion: string;
	readonly specificationHash: string;
	readonly capabilities: readonly string[];
}
export type { ManifestValidationResult, ResourceOperationReport };
