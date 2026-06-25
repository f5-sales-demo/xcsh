#!/usr/bin/env bun

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";

interface SpecPathOperation {
	operationId?: string;
	[key: string]: unknown;
}

const DEDUP_SUFFIX_RE = /_(get|post|put|delete|patch)(_\d+)?$/;

function normalizeOperationId(opId: string): string {
	return opId.replace(DEDUP_SUFFIX_RE, "");
}

function findResourceSchemaComponents(
	resourceName: string,
	paths: Record<string, Record<string, SpecPathOperation>>,
): string[] {
	const name = resourceName.replace(/-/g, "_");
	const plural = name.endsWith("s") ? name : `${name}s`;
	const found = new Set<string>();

	for (const [pathKey, methods] of Object.entries(paths)) {
		const segments = pathKey.split("/");
		if (!segments.some(s => s === name || s === plural)) continue;

		for (const op of Object.values(methods)) {
			const opId = op?.operationId;
			if (!opId) continue;
			const match = normalizeOperationId(opId).match(/^ves\.io\.schema\.(.+?)\.(?:API|CustomAPI)\./);
			if (match) found.add(match[1]);
		}
	}

	return [...found];
}

interface IndexEntryResource {
	name: string;
	description: string;
	description_short?: string;
	tier?: string;
	icon?: string;
	supports_logs?: boolean;
	supports_metrics?: boolean;
	dependencies?: { required: string[]; optional: string[] };
	relationship_hints?: string[];
	schema_components?: string[];
	api_paths?: string[];
}

interface IndexEntry {
	domain: string;
	title: string;
	description: string;
	"x-f5xc-description-short": string;
	"x-f5xc-description-medium"?: string;
	"x-f5xc-icon"?: string;
	"x-f5xc-is-preview"?: boolean;
	"x-f5xc-requires-tier"?: string;
	file: string;
	path_count: number;
	schema_count: number;
	"x-f5xc-complexity": string;
	"x-f5xc-category": string;
	"x-f5xc-use-cases"?: string[];
	"x-f5xc-related-domains"?: string[];
	"x-f5xc-primary-resources"?: IndexEntryResource[];
	"x-f5xc-description-long"?: string;
	"x-f5xc-summary"?: string;
	"x-f5xc-logo-svg"?: string;
	"x-f5xc-cli-domain"?: string;
	"x-f5xc-cli-metadata"?: {
		quick_start: { command: string; description: string; expected_output: string };
		common_workflows: Array<{ name: string; commands: string[] }>;
		troubleshooting: Array<{ symptom: string; fix: string }>;
		icon?: string;
	};
}

interface RawIndex {
	version: string;
	timestamp: string;
	specifications: IndexEntry[];
	"x-f5xc-critical-resources"?: string[];
	"x-f5xc-guided-workflows"?: Record<string, unknown>;
	"x-f5xc-error-resolution"?: Record<string, unknown>;
	"x-f5xc-acronyms"?: Record<string, unknown>;
}

const REPO = "f5xc-salesdemos/api-specs-enriched";
const outputPath = path.resolve(import.meta.dir, "../src/internal-urls/api-spec-index.generated.ts");
const catalogOutputPath = path.resolve(import.meta.dir, "../src/internal-urls/api-catalog-index.generated.ts");

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
	let lastError: Error | null = null;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		if (attempt > 0) {
			const delay = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
			console.warn(`  Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`);
			await Bun.sleep(delay);
		}
		try {
			const response = await fetch(url, init);
			if (response.status === 403 || response.status === 429) {
				const retryAfter = response.headers.get("retry-after");
				const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : INITIAL_BACKOFF_MS * 2 ** attempt;
				console.warn(`  Rate limited (${response.status}), waiting ${waitMs}ms...`);
				await Bun.sleep(waitMs);
				continue;
			}
			return response;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			console.warn(`  Fetch failed: ${lastError.message}`);
		}
	}
	throw lastError ?? new Error(`Failed to fetch ${url} after ${MAX_RETRIES} retries`);
}

function githubHeaders(): Record<string, string> {
	const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
}

async function resolveLatestTag(): Promise<string> {
	const response = await fetchWithRetry(`https://api.github.com/repos/${REPO}/releases/latest`, {
		headers: githubHeaders(),
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch latest release from ${REPO}: ${response.status} ${response.statusText}`);
	}
	const data = (await response.json()) as { tag_name?: string };
	if (!data.tag_name) {
		throw new Error(`Latest release from ${REPO} has no tag_name`);
	}
	return data.tag_name;
}

async function downloadFromRelease(): Promise<string> {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-specs-"));
	downloadedTmpDir = tmpDir;
	const tag = process.env.API_SPECS_TAG ?? (await resolveLatestTag());
	const zipName = `xcsh-api-specs-${tag}.zip`;
	const downloadUrl = `https://github.com/${REPO}/releases/download/${tag}/${zipName}`;

	console.log(`Downloading API specs from ${downloadUrl}...`);
	const response = await fetchWithRetry(downloadUrl, { redirect: "follow" });
	if (!response.ok) {
		throw new Error(`Failed to download release: ${response.status} ${response.statusText}`);
	}

	const zipPath = path.join(tmpDir, zipName);
	const buffer = Buffer.from(await response.arrayBuffer());
	fs.writeFileSync(zipPath, buffer);

	const extractDir = path.join(tmpDir, "extracted");
	fs.mkdirSync(extractDir, { recursive: true });
	const result = await $`unzip -q ${zipPath} -d ${extractDir}`.nothrow();
	if (result.exitCode !== 0) {
		throw new Error(
			`Failed to extract ${zipPath}: unzip exited with code ${result.exitCode}.\n` +
				"Ensure 'unzip' is installed: apt install unzip / brew install unzip",
		);
	}

	const domainsDir = path.join(extractDir, "domains");
	if (fs.existsSync(domainsDir) && fs.existsSync(path.join(extractDir, "index.json"))) {
		for (const file of fs.readdirSync(domainsDir)) {
			fs.copyFileSync(path.join(domainsDir, file), path.join(extractDir, file));
		}
	}

	return extractDir;
}

async function findSpecsDir(): Promise<string> {
	const envDir = process.env.API_SPECS_DIR;
	if (envDir && fs.existsSync(envDir)) {
		return envDir;
	}

	const localCheckout = path.resolve(import.meta.dir, "../../../../api-specs-enriched/docs/specifications/api");
	if (fs.existsSync(localCheckout)) {
		return localCheckout;
	}

	return downloadFromRelease();
}

async function downloadCatalog(specsDir: string): Promise<Record<string, unknown> | null> {
	const catalogPath = path.join(specsDir, "api-catalog.json");
	if (fs.existsSync(catalogPath)) {
		return JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
	}

	const catalogTag = process.env.API_SPECS_TAG ?? (await resolveLatestTag());
	const catalogUrl = `https://github.com/${REPO}/releases/download/${catalogTag}/api-catalog.json`;
	console.log(`Downloading API catalog from ${catalogUrl}...`);
	try {
		const response = await fetchWithRetry(catalogUrl, { redirect: "follow" });
		if (!response.ok) {
			console.warn(`api-catalog.json not found (${response.status}), skipping catalog generation`);
			return null;
		}
		const text = await response.text();
		return JSON.parse(text);
	} catch (err) {
		console.warn(`Failed to download api-catalog.json: ${err instanceof Error ? err.message : err}`);
		return null;
	}
}

async function downloadValidation(specsDir: string): Promise<Record<string, unknown> | null> {
	const validationPath = path.join(specsDir, "validation.json");
	if (fs.existsSync(validationPath)) {
		return JSON.parse(fs.readFileSync(validationPath, "utf-8"));
	}

	const validationTag = process.env.API_SPECS_TAG ?? (await resolveLatestTag());
	const validationUrl = `https://github.com/${REPO}/releases/download/${validationTag}/validation.json`;
	console.log(`Downloading validation.json from ${validationUrl}...`);
	try {
		const response = await fetchWithRetry(validationUrl, { redirect: "follow" });
		if (!response.ok) {
			console.warn(`validation.json not found (${response.status}), skipping validation data generation`);
			return null;
		}
		const text = await response.text();
		return JSON.parse(text);
	} catch (err) {
		console.warn(`Failed to download validation.json: ${err instanceof Error ? err.message : err}`);
		return null;
	}
}

function serializeEnrichment(key: string, value: unknown): string | undefined {
	if (!value) return undefined;
	return `\t${key}: ${JSON.stringify(value)},`;
}

let downloadedTmpDir: string | null = null;

if (fs.existsSync(outputPath) && fs.existsSync(catalogOutputPath) && process.env.CI) {
	console.log("Generated spec files already exist in CI — skipping regeneration.");
	process.exit(0);
}

const specsDir = await findSpecsDir();
console.log(`Reading specs from: ${specsDir}`);

const indexPath = path.join(specsDir, "index.json");
if (!fs.existsSync(indexPath)) {
	console.error(`index.json not found at: ${indexPath}`);
	process.exit(1);
}

const rawIndex: RawIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));

const catalog = await downloadCatalog(specsDir);
const validation = await downloadValidation(specsDir);

const pathToCatalogCategories = new Map<string, string[]>();
if (catalog) {
	const cats = (catalog.categories ?? []) as Array<{ name: string; operations: Array<{ path: string }> }>;
	for (const cat of cats) {
		for (const op of cat.operations ?? []) {
			if (!op.path) continue;
			const existing = pathToCatalogCategories.get(op.path) ?? [];
			existing.push(cat.name);
			pathToCatalogCategories.set(op.path, existing);
		}
	}
}

const domainEntries: string[] = [];
const specDataEntries: string[] = [];
let processedCount = 0;
let skippedCount = 0;

for (const entry of rawIndex.specifications) {
	const specFile = path.join(specsDir, entry.file);
	if (!fs.existsSync(specFile)) {
		console.warn(`  Skipping ${entry.domain}: spec file not found at ${specFile}`);
		skippedCount++;
		continue;
	}

	const specContent = fs.readFileSync(specFile, "utf-8");
	const specJson = JSON.parse(specContent) as {
		paths?: Record<string, Record<string, SpecPathOperation>>;
		info?: Record<string, unknown>;
		components?: { schemas?: Record<string, Record<string, unknown>> };
		[k: string]: unknown;
	};

	const resources = (entry["x-f5xc-primary-resources"] ?? []).map(r => {
		const upstreamSc = r.schema_components ?? [];
		const schemaComponents =
			upstreamSc.length > 0 ? upstreamSc : findResourceSchemaComponents(r.name, specJson.paths ?? {});
		const fields: string[] = [`name: ${JSON.stringify(r.name)}`, `description: ${JSON.stringify(r.description)}`];
		if (schemaComponents.length > 0) fields.push(`schemaComponents: ${JSON.stringify(schemaComponents)}`);
		if (r.api_paths?.length) fields.push(`apiPaths: ${JSON.stringify(r.api_paths)}`);
		if (r.tier) fields.push(`tier: ${JSON.stringify(r.tier)}`);
		if (r.icon) fields.push(`icon: ${JSON.stringify(r.icon)}`);
		if (r.description_short) fields.push(`descriptionShort: ${JSON.stringify(r.description_short)}`);
		if (r.supports_logs != null) fields.push(`supportsLogs: ${r.supports_logs}`);
		if (r.supports_metrics != null) fields.push(`supportsMetrics: ${r.supports_metrics}`);
		if (r.dependencies && (r.dependencies.required.length > 0 || r.dependencies.optional.length > 0)) {
			fields.push(`dependencies: ${JSON.stringify(r.dependencies)}`);
		}
		if (r.relationship_hints?.length) fields.push(`relationshipHints: ${JSON.stringify(r.relationship_hints)}`);
		const catalogCats = new Set<string>();
		for (const ap of r.api_paths ?? []) {
			for (const cat of pathToCatalogCategories.get(ap) ?? []) {
				catalogCats.add(cat);
			}
		}
		if (catalogCats.size > 0) fields.push(`catalogCategories: ${JSON.stringify([...catalogCats])}`);
		return `\t\t\t{ ${fields.join(", ")} },`;
	});

	const useCases = entry["x-f5xc-use-cases"];
	const relatedDomains = entry["x-f5xc-related-domains"];
	const rawBp = specJson.info?.["x-f5xc-best-practices"] as Record<string, unknown> | undefined;
	const bpData = rawBp
		? {
				commonErrors: rawBp.common_errors ?? [],
				securityNotes: rawBp.security_notes ?? [],
				performanceTips: rawBp.performance_tips ?? [],
			}
		: undefined;

	domainEntries.push(
		[
			"\t\t{",
			`\t\t\tdomain: ${JSON.stringify(entry.domain)},`,
			`\t\t\ttitle: ${JSON.stringify(entry.title)},`,
			`\t\t\tdescription: ${JSON.stringify(entry.description)},`,
			`\t\t\tdescriptionShort: ${JSON.stringify(entry["x-f5xc-description-short"])},`,
			`\t\t\tcategory: ${JSON.stringify(entry["x-f5xc-category"])},`,
			`\t\t\tpathCount: ${entry.path_count},`,
			`\t\t\tschemaCount: ${entry.schema_count},`,
			`\t\t\tcomplexity: ${JSON.stringify(entry["x-f5xc-complexity"])},`,
			`\t\t\tresources: [`,
			...resources,
			`\t\t\t],`,
			useCases ? `\t\t\tuseCases: ${JSON.stringify(useCases)},` : undefined,
			relatedDomains?.length ? `\t\t\trelatedDomains: ${JSON.stringify(relatedDomains)},` : undefined,
			entry["x-f5xc-icon"] ? `\t\t\ticon: ${JSON.stringify(entry["x-f5xc-icon"])},` : undefined,
			entry["x-f5xc-description-medium"]
				? `\t\t\tdescriptionMedium: ${JSON.stringify(entry["x-f5xc-description-medium"])},`
				: undefined,
			entry["x-f5xc-is-preview"] ? `\t\t\tisPreview: true,` : undefined,
			entry["x-f5xc-requires-tier"]
				? `\t\t\trequiresTier: ${JSON.stringify(entry["x-f5xc-requires-tier"])},`
				: undefined,
			entry["x-f5xc-description-long"]
				? `\t\t\tdescriptionLong: ${JSON.stringify(entry["x-f5xc-description-long"])},`
				: undefined,
			entry["x-f5xc-summary"] ? `\t\t\tsummary: ${JSON.stringify(entry["x-f5xc-summary"])},` : undefined,
			entry["x-f5xc-logo-svg"] ? `\t\t\tlogoSvg: ${JSON.stringify(entry["x-f5xc-logo-svg"])},` : undefined,
			entry["x-f5xc-cli-domain"] ? `\t\t\tcliDomain: ${JSON.stringify(entry["x-f5xc-cli-domain"])},` : undefined,
			entry["x-f5xc-cli-metadata"]
				? (() => {
						const raw = entry["x-f5xc-cli-metadata"]!;
						const qs = raw.quick_start;
						return `\t\t\tcliMetadata: ${JSON.stringify({
							quickStart: {
								command: qs.command,
								description: qs.description,
								expectedOutput: qs.expected_output,
							},
							commonWorkflows: (raw.common_workflows ?? []).map((w: { name: string; commands: string[] }) => ({
								name: w.name,
								commands: w.commands,
							})),
							troubleshooting: (raw.troubleshooting ?? []).map((t: { symptom: string; fix: string }) => ({
								symptom: t.symptom,
								fix: t.fix,
							})),
							icon: raw.icon,
						})},`;
					})()
				: undefined,
			bpData ? `\t\t\tbestPractices: ${JSON.stringify(bpData)},` : undefined,
			"\t\t},",
		]
			.filter(Boolean)
			.join("\n"),
	);

	specDataEntries.push(`\t${JSON.stringify(entry.domain)}: ${JSON.stringify(specJson)},`);
	processedCount++;
}

const criticalResources = rawIndex["x-f5xc-critical-resources"];
const guidedWorkflows = rawIndex["x-f5xc-guided-workflows"];
const errorResolution = rawIndex["x-f5xc-error-resolution"];
const acronyms = rawIndex["x-f5xc-acronyms"];

// Extract operation-level and schema-level enrichments per domain
const enrichmentEntries: string[] = [];

for (const entry of rawIndex.specifications) {
	const specFile = path.join(specsDir, entry.file);
	if (!fs.existsSync(specFile)) continue;

	const enrichSpecContent = fs.readFileSync(specFile, "utf-8");
	const enrichSpecJson = JSON.parse(enrichSpecContent) as {
		paths?: Record<string, Record<string, Record<string, unknown>>>;
		components?: { schemas?: Record<string, Record<string, unknown>> };
	};

	const operationMeta: Record<string, Record<string, unknown>> = {};
	for (const methods of Object.values(enrichSpecJson.paths ?? {})) {
		for (const op of Object.values(methods)) {
			if (typeof op !== "object" || !op) continue;
			const opId = op.operationId as string | undefined;
			if (!opId) continue;
			const enrichment: Record<string, unknown> = {};
			if (op["x-f5xc-danger-level"]) enrichment.dangerLevel = op["x-f5xc-danger-level"];
			if (op["x-f5xc-confirmation-required"] != null)
				enrichment.confirmationRequired = op["x-f5xc-confirmation-required"];
			if (op["x-f5xc-side-effects"]) enrichment.sideEffects = op["x-f5xc-side-effects"];
			if (op["x-f5xc-discovered-response-time"]) {
				const rt = op["x-f5xc-discovered-response-time"] as Record<string, unknown>;
				enrichment.discoveredResponseTime = {
					p50Ms: rt.p50_ms,
					p95Ms: rt.p95_ms,
					p99Ms: rt.p99_ms,
					sampleCount: rt.sample_count,
					source: rt.source,
				};
			}
			if (op["x-f5xc-required-fields"]) enrichment.requiredFields = op["x-f5xc-required-fields"];
			if (op["x-f5xc-operation-metadata"]) {
				const om = op["x-f5xc-operation-metadata"] as Record<string, unknown>;
				const mapped: Record<string, unknown> = { purpose: om.purpose };
				if (om.conditions) {
					const cond = om.conditions as Record<string, unknown>;
					if (cond.prerequisites) mapped.prerequisites = cond.prerequisites;
					if (cond.postconditions) mapped.postconditions = cond.postconditions;
				}
				if (om.common_errors) {
					mapped.commonErrors = (om.common_errors as Array<Record<string, unknown>>).map(e => ({
						code: e.code,
						message: e.message,
						resolution: e.resolution ?? e.solution ?? "",
					}));
				}
				if (om.performance_impact) {
					const pi = om.performance_impact as Record<string, unknown>;
					mapped.performanceImpact = { latency: pi.latency, resourceUsage: pi.resource_usage };
				}
				enrichment.operationMetadata = mapped;
			}
			if (Object.keys(enrichment).length > 0) operationMeta[opId] = enrichment;
		}
	}

	const schemaEnrichments: Record<string, Record<string, unknown>> = {};
	for (const [schemaName, schemaDef] of Object.entries(enrichSpecJson.components?.schemas ?? {})) {
		const rec = schemaDef["x-f5xc-recommended-oneof-variant"] as Record<string, string> | undefined;
		const minConfig = schemaDef["x-f5xc-minimum-configuration"] as Record<string, unknown> | undefined;
		if (rec || minConfig) {
			schemaEnrichments[schemaName] = {
				...(rec ? { recommendedOneofVariant: rec } : {}),
				...(minConfig ? { minimumConfiguration: minConfig } : {}),
			};
		}
	}

	if (Object.keys(operationMeta).length > 0 || Object.keys(schemaEnrichments).length > 0) {
		enrichmentEntries.push(
			`\t${JSON.stringify(entry.domain)}: { operationMeta: ${JSON.stringify(operationMeta)}, schemaEnrichments: ${JSON.stringify(schemaEnrichments)} },`,
		);
	}
}

const output = [
	"// Auto-generated by scripts/generate-api-spec-index.ts - DO NOT EDIT",
	"",
	`import type { ApiSpecDomainEnrichments, ApiSpecIndex, ApiSpecValidationResourceEntry } from "./api-spec-types";`,
	"",
	`export const API_SPEC_VERSION = ${JSON.stringify(rawIndex.version)};`,
	"",
	`export const API_SPEC_INDEX: ApiSpecIndex = {`,
	`\tversion: ${JSON.stringify(rawIndex.version)},`,
	`\ttimestamp: ${JSON.stringify(rawIndex.timestamp)},`,
	`\tdomains: [`,
	...domainEntries,
	`\t],`,
	serializeEnrichment("criticalResources", criticalResources),
	serializeEnrichment("guidedWorkflows", guidedWorkflows),
	serializeEnrichment("errorResolution", errorResolution),
	serializeEnrichment("acronyms", acronyms),
	`};`,
	"",
	`export const API_SPEC_DATA: Readonly<Record<string, unknown>> = {`,
	...specDataEntries,
	`};`,
	"",
	`export const API_SPEC_ENRICHMENTS: Readonly<Record<string, ApiSpecDomainEnrichments>> = {`,
	...enrichmentEntries,
	`};`,
	"",
	...(validation
		? [
				`export const API_VALIDATION_DATA: Readonly<Record<string, ApiSpecValidationResourceEntry>> = ${JSON.stringify((validation as { required_fields?: { resources?: Record<string, unknown> } }).required_fields?.resources ?? {})};`,
				"",
			]
		: [`export const API_VALIDATION_DATA: Readonly<Record<string, ApiSpecValidationResourceEntry>> = {};`, ""]),
]
	.filter(l => l !== undefined)
	.join("\n");

await Bun.write(outputPath, output);

const outputSize = (Buffer.byteLength(output) / 1024 / 1024).toFixed(1);
console.log(
	`Generated ${path.relative(process.cwd(), outputPath)} (${processedCount} domains, ${skippedCount} skipped, ${outputSize} MB)`,
);

// Generate API catalog index
if (catalog) {
	const categories = (catalog.categories ?? []) as Array<{ name: string; displayName: string; operations: unknown[] }>;
	const catalogIndexEntries: string[] = [];

	const catalogDataEntries: string[] = [];
	for (const cat of categories) {
		catalogDataEntries.push(`\t${JSON.stringify(cat.name)}: ${JSON.stringify(cat)},`);
		catalogIndexEntries.push(
			`\t\t{ name: ${JSON.stringify(cat.name)}, displayName: ${JSON.stringify(cat.displayName)}, operationCount: ${cat.operations?.length ?? 0} },`,
		);
	}

	const catalogOutput = [
		"// Auto-generated by scripts/generate-api-spec-index.ts - DO NOT EDIT",
		"",
		`import type { ApiCatalogCategory, ApiCatalogCategorySummary, ApiCatalogIndex } from "./api-catalog-types";`,
		"",
		`export const API_CATALOG_INDEX: ApiCatalogIndex = {`,
		`\tversion: ${JSON.stringify(catalog.version ?? "unknown")},`,
		`\tdisplayName: ${JSON.stringify(catalog.displayName ?? "F5 Distributed Cloud")},`,
		`\tservice: ${JSON.stringify(catalog.service ?? "xcsh")},`,
		`\tcategoryCount: ${categories.length},`,
		`\tauth: ${JSON.stringify(catalog.auth ?? {})},`,
		`\tdefaults: ${JSON.stringify(catalog.defaults ?? {})},`,
		`};`,
		"",
		`export const API_CATALOG_CATEGORY_SUMMARIES: ReadonlyArray<ApiCatalogCategorySummary> = [`,
		...catalogIndexEntries,
		`];`,
		"",
		`export const API_CATALOG_DATA: Readonly<Record<string, ApiCatalogCategory>> = {`,
		...catalogDataEntries,
		`};`,
		"",
	].join("\n");

	await Bun.write(catalogOutputPath, catalogOutput);
	const catalogSize = (Buffer.byteLength(catalogOutput) / 1024 / 1024).toFixed(1);
	console.log(
		`Generated ${path.relative(process.cwd(), catalogOutputPath)} (${categories.length} categories, ${catalogSize} MB)`,
	);
}

if (downloadedTmpDir) {
	fs.rmSync(downloadedTmpDir, { recursive: true, force: true });
}
