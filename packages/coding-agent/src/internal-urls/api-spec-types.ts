/**
 * Types for the embedded API specification index and domain specs.
 *
 * These types define the shape of data generated at build time by
 * scripts/generate-api-spec-index.ts from the api-specs-enriched repository.
 */

export interface ApiSpecDomainResource {
	readonly name: string;
	readonly description: string;
	readonly schemaComponents?: readonly string[];
	readonly apiPaths?: readonly string[];
	readonly tier?: string;
	readonly icon?: string;
	readonly descriptionShort?: string;
	readonly supportsLogs?: boolean;
	readonly supportsMetrics?: boolean;
	readonly dependencies?: {
		readonly required: readonly string[];
		readonly optional: readonly string[];
	};
	readonly relationshipHints?: readonly string[];
	readonly catalogCategories?: readonly string[];
}

export interface ApiSpecCliMetadata {
	readonly quickStart: {
		readonly command: string;
		readonly description: string;
		readonly expectedOutput: string;
	};
	readonly commonWorkflows: readonly {
		readonly name: string;
		readonly commands?: readonly string[];
	}[];
	readonly troubleshooting: readonly {
		readonly symptom?: string;
		readonly fix?: string;
	}[];
	readonly icon?: string;
}

export interface ApiSpecBestPractices {
	readonly commonErrors: readonly {
		readonly code: number;
		readonly message: string;
		readonly resolution: string;
		readonly prevention: string;
	}[];
	readonly securityNotes: readonly string[];
	readonly performanceTips: readonly string[];
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
	readonly icon?: string;
	readonly descriptionMedium?: string;
	readonly isPreview?: boolean;
	readonly requiresTier?: string;
	readonly descriptionLong?: string;
	readonly summary?: string;
	readonly logoSvg?: string;
	readonly cliDomain?: string;
	readonly cliMetadata?: ApiSpecCliMetadata;
	readonly bestPractices?: ApiSpecBestPractices;
}

export interface ApiSpecGuidedWorkflows {
	readonly version: string;
	readonly total_workflows: number;
	readonly domains: readonly string[];
	readonly workflows: readonly ApiSpecGuidedWorkflow[];
}

export interface ApiSpecGuidedWorkflow {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly complexity: string;
	readonly estimated_steps: number;
	readonly prerequisites: readonly string[];
	readonly steps: readonly ApiSpecGuidedWorkflowStep[];
	readonly domain: string;
}

export interface ApiSpecGuidedWorkflowStep {
	readonly order: number;
	readonly action: string;
	readonly name: string;
	readonly description: string;
	readonly resource?: string;
	readonly required_fields?: readonly string[];
	readonly tips?: readonly string[];
	readonly optional?: boolean;
	readonly depends_on?: readonly number[];
	readonly verification?: readonly string[];
}

export interface ApiSpecHttpError {
	readonly code: number;
	readonly name: string;
	readonly description: string;
	readonly common_causes: readonly string[];
	readonly diagnostic_steps: readonly {
		readonly step: number;
		readonly action: string;
		readonly description: string;
		readonly command?: string;
	}[];
	readonly prevention: readonly string[];
	readonly related_errors?: readonly number[];
}

export interface ApiSpecResourceErrorEntry {
	readonly error_code: number;
	readonly pattern: string;
	readonly resolution: string;
}

export interface ApiSpecErrorResolution {
	readonly version: string;
	readonly http_errors: Record<string, ApiSpecHttpError>;
	readonly resource_errors: Record<string, readonly ApiSpecResourceErrorEntry[]>;
}

export interface ApiSpecAcronym {
	readonly acronym: string;
	readonly expansion: string;
	readonly category: string;
}

export interface ApiSpecAcronyms {
	readonly version: string;
	readonly categories: readonly string[];
	readonly acronyms: readonly ApiSpecAcronym[];
}

export interface ApiSpecOperationEnrichment {
	readonly dangerLevel?: "low" | "medium" | "high";
	readonly confirmationRequired?: boolean;
	readonly sideEffects?: {
		readonly creates?: readonly string[];
		readonly deletes?: readonly string[];
		readonly modifies?: readonly string[];
	};
	readonly discoveredResponseTime?: {
		readonly p50Ms: number;
		readonly p95Ms: number;
		readonly p99Ms: number;
		readonly sampleCount: number;
		readonly source: string;
	};
	readonly requiredFields?: readonly string[];
	readonly operationMetadata?: {
		readonly purpose: string;
		readonly prerequisites?: readonly string[];
		readonly postconditions?: readonly string[];
		readonly commonErrors?: readonly {
			readonly code: number;
			readonly message: string;
			readonly resolution: string;
		}[];
		readonly performanceImpact?: {
			readonly latency: string;
			readonly resourceUsage: string;
		};
	};
}

export interface ApiSpecSchemaEnrichment {
	readonly recommendedOneofVariant?: Readonly<Record<string, string>>;
}

export interface ApiSpecDomainEnrichments {
	readonly operationMeta: Readonly<Record<string, ApiSpecOperationEnrichment>>;
	readonly schemaEnrichments: Readonly<Record<string, ApiSpecSchemaEnrichment>>;
}

export interface ApiSpecIndex {
	readonly version: string;
	readonly timestamp: string;
	readonly domains: readonly ApiSpecDomainEntry[];
	readonly criticalResources?: readonly string[];
	readonly guidedWorkflows?: ApiSpecGuidedWorkflows;
	readonly errorResolution?: ApiSpecErrorResolution;
	readonly acronyms?: ApiSpecAcronyms;
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
