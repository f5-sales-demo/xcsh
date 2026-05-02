/**
 * Types for the embedded API catalog index.
 *
 * The catalog provides pre-built curl templates and operation metadata
 * generated at build time from api-catalog.json in the api-specs-enriched repository.
 */

export interface ApiCatalogParameter {
	readonly name: string;
	readonly in: string;
	readonly required: boolean;
	readonly type: string;
	readonly default?: string;
}

export interface ApiCatalogMinimumPayload {
	readonly json: Record<string, unknown>;
	readonly requiredFields: readonly string[];
	readonly description: string;
}

export interface ApiCatalogFieldMeta {
	readonly type: string;
	readonly description?: string;
	readonly required_for?: {
		readonly minimum_config?: boolean;
		readonly create?: boolean;
		readonly update?: boolean;
		readonly read?: boolean;
	};
	readonly serverDefault?: boolean;
	readonly default?: unknown;
	readonly recommendedValue?: unknown;
	readonly constraints?: Record<string, unknown>;
	readonly conflictsWith?: readonly string[];
}

export interface ApiCatalogResponseField {
	readonly field: string;
	readonly type: string;
	readonly description: string;
}

export interface ApiCatalogOperation {
	readonly name: string;
	readonly description: string;
	readonly method: string;
	readonly path: string;
	readonly dangerLevel: string;
	readonly parameters: readonly ApiCatalogParameter[];
	readonly bodySchema?: Record<string, unknown>;
	readonly responseSchema?: Record<string, unknown>;
	readonly minimumPayload?: ApiCatalogMinimumPayload;
	readonly fieldMetadata?: Readonly<Record<string, ApiCatalogFieldMeta>>;
	readonly oneOfRecommendations?: Readonly<Record<string, string>>;
	readonly responseSummary?: readonly ApiCatalogResponseField[];
}

export interface ApiCatalogCategory {
	readonly name: string;
	readonly displayName: string;
	readonly operations: readonly ApiCatalogOperation[];
}

export interface ApiCatalogAuth {
	readonly type: string;
	readonly headerName: string;
	readonly headerTemplate: string;
	readonly tokenSource: string;
	readonly baseUrlSource: string;
}

export interface ApiCatalogIndex {
	readonly version: string;
	readonly displayName: string;
	readonly service: string;
	readonly categoryCount: number;
	readonly auth: ApiCatalogAuth;
	readonly defaults: Record<string, { readonly source: string }>;
}

export interface ApiCatalogCategorySummary {
	readonly name: string;
	readonly displayName: string;
	readonly operationCount: number;
}
