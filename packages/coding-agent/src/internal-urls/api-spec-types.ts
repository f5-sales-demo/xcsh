/**
 * Types for the embedded API specification index and domain specs.
 *
 * These types define the shape of data generated at build time by
 * scripts/generate-api-spec-index.ts from the api-specs-enriched repository.
 */

export interface ApiSpecDomainResource {
	readonly name: string;
	readonly description: string;
}

export interface ApiSpecDomainEntry {
	readonly domain: string;
	readonly title: string;
	readonly description: string;
	readonly descriptionShort: string;
	readonly category: string;
	readonly pathCount: number;
	readonly schemaCount: number;
	readonly complexity: string;
	readonly resources: readonly ApiSpecDomainResource[];
	readonly useCases?: readonly string[];
	readonly relatedDomains?: readonly string[];
}

export interface ApiSpecIndex {
	readonly version: string;
	readonly timestamp: string;
	readonly domains: readonly ApiSpecDomainEntry[];
}

export interface OpenAPIPathOperation {
	readonly summary?: string;
	readonly description?: string;
	readonly operationId?: string;
	readonly parameters?: readonly Record<string, unknown>[];
	readonly requestBody?: Record<string, unknown>;
	readonly responses?: Record<string, unknown>;
	readonly [key: string]: unknown;
}

export interface OpenAPISpec {
	readonly info: {
		readonly title: string;
		readonly version: string;
		readonly [key: string]: unknown;
	};
	readonly paths: Record<string, Record<string, OpenAPIPathOperation>>;
	readonly components?: {
		readonly schemas?: Record<string, Record<string, unknown>>;
		readonly [key: string]: unknown;
	};
	readonly [key: string]: unknown;
}
