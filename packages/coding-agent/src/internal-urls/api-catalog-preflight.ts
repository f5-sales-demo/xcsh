import os from "node:os";
import path from "node:path";
import { rankQmdBm25CatalogDiscovery } from "./api-catalog-discovery";
import { QMD_API_CATALOG_PREBUILT_INDEX } from "./api-catalog-qmd-index.generated";
import type { ApiSpecIndex } from "./api-spec-types";
import {
	buildKnowledgeSearchPlan,
	classifyKnowledgeRequest,
	type KnowledgeClassifierResource,
	type KnowledgeSearchPlan,
} from "./knowledge-classifier";

export interface ApiCatalogPreflightResource extends KnowledgeClassifierResource {}

export interface ApiCatalogPreflightIntent {
	readonly resource: string;
	readonly domain: string;
	readonly queries: readonly string[];
	readonly structuredQuery?: KnowledgeSearchPlan;
}

export interface ApiCatalogPreflightDestination {
	readonly rank: number;
	readonly category: string;
	readonly resource: string;
	readonly domain: string;
	readonly catalogUrl: string;
	readonly resourceUrl: string;
	readonly specUrl: string;
}

export interface ApiCatalogPreflightResult extends ApiCatalogPreflightIntent {
	readonly catalogVersion: string;
	readonly searchUrls: readonly string[];
	readonly ranked: readonly ApiCatalogPreflightDestination[];
	readonly durationMs: number;
}

interface ApiCatalogPreflightOptions {
	readonly toolsEnabled: boolean;
	readonly resources?: readonly ApiCatalogPreflightResource[];
	readonly previousResource?: ApiCatalogPreflightIntent;
}

interface RunApiCatalogPreflightOptions extends ApiCatalogPreflightOptions {
	readonly catalogVersion?: string;
	readonly rank?: (query: string) => Promise<readonly string[]>;
}

let generatedResources: readonly ApiCatalogPreflightResource[] | undefined;
let generatedCatalogVersion: string | undefined;

function normalizedPhrase(value: string): string {
	return value
		.toLocaleLowerCase("en-US")
		.replace(/[_-]+/g, " ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function defaultAliases(name: string, descriptionShort?: string): string[] {
	const canonical = normalizedPhrase(name);
	const aliases = [normalizedPhrase(descriptionShort ?? ""), canonical].filter(Boolean);
	if (name === "http_loadbalancer") aliases.push("http load balancer", "http lb");
	if (name === "https_loadbalancer") aliases.push("https load balancer", "https lb");
	return [...new Set(aliases)];
}

function loadGeneratedMetadata(): { resources: readonly ApiCatalogPreflightResource[]; catalogVersion: string } {
	if (generatedResources && generatedCatalogVersion) {
		return { resources: generatedResources, catalogVersion: generatedCatalogVersion };
	}
	const specModule = require("./api-spec-index.generated") as { API_SPEC_INDEX: ApiSpecIndex };
	const catalogModule = require("./api-catalog-index.generated") as { API_CATALOG_INDEX: { version: string } };
	generatedResources = specModule.API_SPEC_INDEX.domains.flatMap(domain =>
		domain.resources.map(resource => ({
			name: resource.name,
			aliases: defaultAliases(resource.name, resource.descriptionShort),
			domain: domain.domain,
			categories: resource.catalogCategories ?? [],
		})),
	);
	generatedCatalogVersion = catalogModule.API_CATALOG_INDEX.version;
	return { resources: generatedResources, catalogVersion: generatedCatalogVersion };
}

export function classifyApiCatalogPreflight(
	prompt: string,
	options: ApiCatalogPreflightOptions,
): ApiCatalogPreflightIntent | null {
	if (
		/\b(?:terraform|hcl)\b/i.test(prompt) ||
		/\bxcsh[ _].*\b(?:action|resource|data[ -]source|ephemeral)\b/i.test(prompt) ||
		prompt.includes("xcsh://terraform-documentation/")
	)
		return null;
	const resources = options.resources ?? loadGeneratedMetadata().resources;
	const previous = options.previousResource
		? {
				route: "api" as const,
				confidence: 0.99,
				resource: options.previousResource.resource,
				domain: options.previousResource.domain,
				constraints: { domain: options.previousResource.domain },
				query:
					options.previousResource.structuredQuery ??
					buildKnowledgeSearchPlan(
						"api",
						options.previousResource.queries[0] ?? options.previousResource.resource,
					),
			}
		: undefined;
	const classified = classifyKnowledgeRequest(prompt, { toolsEnabled: options.toolsEnabled, resources, previous });
	if (classified.route !== "api" || !classified.resource || !classified.domain) return null;
	if (
		options.previousResource &&
		classified.resource === options.previousResource.resource &&
		/\b(?:its|it|that|this|those|them|the same)\b/i.test(prompt)
	) {
		return options.previousResource;
	}
	return {
		resource: classified.resource,
		domain: classified.domain,
		queries: classified.query.lex,
		structuredQuery: classified.query,
	};
}

export async function runApiCatalogPreflight(
	prompt: string,
	options: RunApiCatalogPreflightOptions,
): Promise<ApiCatalogPreflightResult | null> {
	const metadata = options.resources
		? { resources: options.resources, catalogVersion: options.catalogVersion ?? "unknown" }
		: loadGeneratedMetadata();
	const intent = classifyApiCatalogPreflight(prompt, {
		toolsEnabled: options.toolsEnabled,
		resources: metadata.resources,
		previousResource: options.previousResource,
	});
	if (!intent) return null;

	const started = performance.now();
	const rank =
		options.rank ??
		(async (query: string) =>
			(
				await rankQmdBm25CatalogDiscovery(query, {
					cacheRoot: path.join(os.homedir(), ".xcsh", "cache", "qmd-api-catalog"),
					prebuiltIndex: QMD_API_CATALOG_PREBUILT_INDEX,
					limit: 5,
				})
			).map(candidate => candidate.categoryName));

	try {
		const rankedCategories: string[] = [];
		const rankedQueries: (readonly string[])[] = [];
		for (const query of intent.queries) rankedQueries.push(await rank(query));
		for (let position = 0; rankedCategories.length < 5; position++) {
			let found = false;
			for (const candidates of rankedQueries) {
				const category = candidates[position];
				if (!category) continue;
				found = true;
				if (!rankedCategories.includes(category)) rankedCategories.push(category);
				if (rankedCategories.length === 5) break;
			}
			if (!found) break;
		}
		const selected = metadata.resources.find(resource => resource.name === intent.resource)!;
		const ranked = rankedCategories.slice(0, 5).map((category, index) => {
			return {
				rank: index + 1,
				category,
				resource: selected.name,
				domain: selected.domain,
				catalogUrl: `xcsh://api-catalog/${category}`,
				resourceUrl: `xcsh://api-catalog/?resource=${encodeURIComponent(selected.name)}&compact=true`,
				specUrl: `xcsh://api-spec/${selected.domain}?resource=${encodeURIComponent(selected.name)}`,
			};
		});
		return {
			...intent,
			catalogVersion: metadata.catalogVersion,
			searchUrls: intent.queries.map(query => `xcsh://api-catalog/?search=${encodeURIComponent(query)}`),
			ranked,
			durationMs: Math.round((performance.now() - started) * 1000) / 1000,
		};
	} catch (error) {
		throw new Error(`Local API catalog discovery failed: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
}
