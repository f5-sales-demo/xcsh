#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import { API_CATALOG_DATA } from "../src/internal-urls/api-catalog-index.generated";
import { API_SPEC_INDEX } from "../src/internal-urls/api-spec-index.generated";

const SEED = 4496;
const outputPath = path.join(import.meta.dir, "fixtures/knowledge-evaluation-v2.json");

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index < 0 ? undefined : process.argv[index + 1];
}

function splitFor(family: string): "tuning" | "sealed" {
	const bucket = createHash("sha256").update(`${SEED}:family:${family}`).digest()[0] ?? 0;
	return bucket % 5 === 0 ? "sealed" : "tuning";
}

const api = Object.values(API_CATALOG_DATA)
	.slice()
	.sort((left, right) => left.name.localeCompare(right.name))
	.flatMap(category =>
		category.operations
			.slice()
			.sort((left, right) => left.operationId.localeCompare(right.operationId))
			.map((operation, index) => {
				const query =
					index % 4 === 0
						? operation.operationId
						: index % 4 === 1
							? operation.path
							: index % 4 === 2
								? operation.name.replaceAll("_", " ")
								: (operation.operationAliases?.[0] ?? operation.description);
				return {
					id: `api-${category.name}-${index + 1}`,
					family: category.name,
					split: splitFor(`api:${category.name}`),
					class: index % 4 === 0 ? "operation-id" : index % 4 === 1 ? "path" : index % 4 === 2 ? "exact-name" : "natural-language",
					query,
					expectedCategories: [category.name],
				};
			}),
	)
	.slice(0, 240);

if (api.length < 240) throw new Error(`API corpus produced only ${api.length} queries`);

const documentationIndex = argument("--documentation-index");
if (!documentationIndex) throw new Error("--documentation-index PATH is required");
const database = new Database(documentationIndex, { readonly: true });
const documentRows = database
	.query(
		"SELECT source, stable_path, title FROM documentation_documents WHERE stable_path NOT LIKE 'api/%' ORDER BY source, stable_path",
	)
	.all() as Array<{
		source: "docs-cloud-f5-com" | "my-f5-com" | "www-f5-com";
		stable_path: string;
		title: string;
	}>;
database.close();

const documentation = (["docs-cloud-f5-com", "my-f5-com", "www-f5-com"] as const).flatMap(source =>
	documentRows
		.filter(row => row.source === source)
		.slice(0, source === "www-f5-com" ? 24 : 80)
		.map((row, index) => {
			const familySegments = row.stable_path.split("/");
			const family =
				source === "my-f5-com"
					? `${source}:${row.stable_path}`
					: `${source}:${familySegments.slice(0, Math.min(2, familySegments.length)).join("/")}`;
			const query = row.title.replace(/\s*\|\s*F5.*$/i, "").trim();
			return {
				id: `docs-${source}-${index + 1}`,
				family,
				split: splitFor(`docs:${family}`),
				query,
				source,
				relevance: { [row.stable_path]: 3 },
			};
		}),
);

if (documentation.filter(row => row.source === "www-f5-com").length !== 24) {
	throw new Error("Documentation corpus must contain all 24 reviewed marketing pages");
}
if (documentation.length < 184) throw new Error(`Documentation corpus produced only ${documentation.length} queries`);

const resourceRows = API_SPEC_INDEX.domains
	.flatMap(domain =>
		domain.resources.map(resource => ({
			name: resource.name,
			aliases: [resource.name.replaceAll("_", " "), resource.descriptionShort ?? ""].filter(Boolean),
			domain: domain.domain,
			categories: resource.catalogCategories ?? [],
		})),
	)
	.filter(resource => resource.categories.length > 0)
	.sort((left, right) => left.domain.localeCompare(right.domain) || left.name.localeCompare(right.name));

const classifierApiTemplates = [
	(name: string) => `What endpoint gets the F5 XC ${name}?`,
	(name: string) => `Which fields are required for an F5 XC ${name} payload?`,
	(name: string) => `What API method lists F5 XC ${name}?`,
];

const classifierApi = resourceRows
	.flatMap(resource =>
		classifierApiTemplates.map((template, templateIndex) => ({
			id: `classifier-api-${resource.domain}-${resource.name}-${templateIndex + 1}`,
			family: `api:${resource.domain}:${resource.name}`,
			split: splitFor(`classifier:api:${resource.domain}:${resource.name}`),
			prompt: template(resource.name.replaceAll("_", " ")),
			expectedRoute: "api" as const,
			resource,
		})),
	)
	.slice(0, 150);

if (classifierApi.length < 150) throw new Error(`Classifier API corpus produced only ${classifierApi.length} prompts`);

const classifierDocumentation = documentation.slice(0, 100).map((row, index) => ({
	id: `classifier-docs-${index + 1}`,
	family: row.family,
	split: splitFor(`classifier:${row.family}`),
	prompt: `Use F5 documentation to find ${row.query}`,
	expectedRoute: "documentation" as const,
	source: row.source,
}));

const negativeTopics = ["AWS", "Azure", "GCP", "Google Cloud", "Kubernetes"];
const classifierNegative = Array.from({ length: 50 }, (_, index) => {
	const topic = negativeTopics[index % negativeTopics.length]!;
	return {
		id: `classifier-none-${index + 1}`,
		family: `negative:${index + 1}`,
		split: splitFor(`classifier:negative:${index + 1}`),
		prompt: `What API endpoint configures third-party ${topic} service ${index + 1}?`,
		expectedRoute: "none" as const,
	};
});

const fixture = {
	schemaVersion: 2,
	seed: SEED,
	policy: "Resource and document families are assigned wholly to tuning or sealed by a seeded SHA-256 bucket.",
	api,
	documentation,
	classifier: [...classifierApi, ...classifierDocumentation, ...classifierNegative],
};

await Bun.write(outputPath, `${JSON.stringify(fixture, null, "\t")}\n`);
console.log(
	JSON.stringify({
		outputPath,
		api: fixture.api.length,
		documentation: fixture.documentation.length,
		classifier: fixture.classifier.length,
	}),
);
