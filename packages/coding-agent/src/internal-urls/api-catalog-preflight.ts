import os from "node:os";
import path from "node:path";
import { rankQmdBm25CatalogDiscovery } from "./api-catalog-discovery";
import { QMD_API_CATALOG_PREBUILT_INDEX } from "./api-catalog-qmd-index.generated";
import type { ApiSpecIndex } from "./api-spec-types";

export interface ApiCatalogPreflightResource {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly domain: string;
	readonly categories: readonly string[];
}

export interface ApiCatalogPreflightIntent {
	readonly resource: string;
	readonly domain: string;
	readonly queries: readonly string[];
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

const EXCLUDED_INTENT =
	/\b(?:troubleshoot|debug|not working|returning\s+\d{3}|pricing|price|quote|licen[cs]ing|sales)\b/i;
const THIRD_PARTY_SCOPE = /\b(?:aws|amazon|azure|gcp|google cloud|kubernetes)\b/i;
const F5_XC_SCOPE = /\b(?:f5(?:\s+distributed\s+cloud)?|xc)\b/i;
const ANAPHORIC_RESOURCE = /\b(?:its|it|that|this)\b/i;
const API_METADATA_INTENT =
	/\b(?:endpoint|api\s+path|http\s+method|method|payload|request\s+body|required\s+fields?|enum|allowed\s+values?|constraints?|limits?|maximum|max(?:imum)?|minimum|min(?:imum)?|how\s+many|create|creates|creating|get|gets|list|lists|update|updates|replace|replaces|delete|deletes|clone|import)\b/i;
const EXPLICIT_API_INTENT = /\b(?:api|endpoint|method|payload|schema)\b/i;

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

function preferredAlias(resource: { name: string; aliases: readonly string[] }): string {
	return normalizedPhrase(resource.aliases[0] ?? resource.name);
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

function crudVerb(prompt: string): string | undefined {
	const value = normalizedPhrase(prompt);
	if (/\b(?:create|creates|creating)\b/.test(value)) return "create";
	if (/\b(?:get|gets|read|fetch)\b/.test(value)) return "get";
	if (/\b(?:list|lists)\b/.test(value)) return "list";
	if (/\b(?:update|updates)\b/.test(value)) return "update";
	if (/\b(?:replace|replaces)\b/.test(value)) return "replace";
	if (/\b(?:delete|deletes|remove)\b/.test(value)) return "delete";
	if (/\bclone\b/.test(value)) return "clone";
	if (/\bimport\b/.test(value)) return "import";
	return undefined;
}

export function classifyApiCatalogPreflight(
	prompt: string,
	options: ApiCatalogPreflightOptions,
): ApiCatalogPreflightIntent | null {
	if (!options.toolsEnabled || EXCLUDED_INTENT.test(prompt)) return null;
	if (THIRD_PARTY_SCOPE.test(prompt) && !F5_XC_SCOPE.test(prompt)) return null;
	if (/\bterraform\b/i.test(prompt) && !EXPLICIT_API_INTENT.test(prompt)) return null;
	if (!API_METADATA_INTENT.test(prompt)) return null;

	const resources = options.resources ?? loadGeneratedMetadata().resources;
	const normalizedPrompt = ` ${normalizedPhrase(prompt)} `;
	const matches = resources
		.flatMap(resource =>
			resource.aliases
				.map(alias => normalizedPhrase(alias))
				.filter(alias => alias && normalizedPrompt.includes(` ${alias} `))
				.map(alias => ({ resource, alias })),
		)
		.sort(
			(left, right) =>
				right.alias.length - left.alias.length ||
				right.resource.categories.length - left.resource.categories.length ||
				left.resource.name.localeCompare(right.resource.name) ||
				left.resource.domain.localeCompare(right.resource.domain),
		);
	const selected = matches[0]?.resource;
	if (!selected) {
		if (ANAPHORIC_RESOURCE.test(prompt) && options.previousResource) return options.previousResource;
		return null;
	}

	const alias = preferredAlias(selected);
	const verb = crudVerb(prompt);
	return {
		resource: selected.name,
		domain: selected.domain,
		queries: verb ? [alias, `${verb} ${alias}`] : [alias],
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
