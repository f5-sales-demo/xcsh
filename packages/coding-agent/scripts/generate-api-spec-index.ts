#!/usr/bin/env bun

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import { $ } from "bun";

interface SpecPathOperation {
	operationId?: string;
	[key: string]: unknown;
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
			const match = opId.match(/^ves\.io\.schema\.(.+?)\.(?:API|CustomAPI)\./);
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

async function resolveLatestTag(): Promise<string> {
	const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
		headers: { Accept: "application/vnd.github+json" },
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
	const zipName = `f5xc-api-specs-${tag}.zip`;
	const downloadUrl = `https://github.com/${REPO}/releases/download/${tag}/${zipName}`;

	console.log(`Downloading API specs from ${downloadUrl}...`);
	const response = await fetch(downloadUrl, { redirect: "follow" });
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
		const response = await fetch(catalogUrl, { redirect: "follow" });
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

function serializeEnrichment(key: string, value: unknown): string | undefined {
	if (!value) return undefined;
	return `\t${key}: ${JSON.stringify(value)},`;
}

let downloadedTmpDir: string | null = null;

const specsDir = await findSpecsDir();
console.log(`Reading specs from: ${specsDir}`);

const indexPath = path.join(specsDir, "index.json");
if (!fs.existsSync(indexPath)) {
	console.error(`index.json not found at: ${indexPath}`);
	process.exit(1);
}

const rawIndex: RawIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));

const domainEntries: string[] = [];
const blobEntries: string[] = [];
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
		[k: string]: unknown;
	};
	const compressed = gzipSync(Buffer.from(specContent));
	const b64 = compressed.toString("base64");

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
		return `\t\t\t{ ${fields.join(", ")} },`;
	});

	const useCases = entry["x-f5xc-use-cases"];
	const relatedDomains = entry["x-f5xc-related-domains"];

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
			"\t\t},",
		]
			.filter(Boolean)
			.join("\n"),
	);

	blobEntries.push(`\t${JSON.stringify(entry.domain)}: ${JSON.stringify(b64)},`);
	processedCount++;
}

const criticalResources = rawIndex["x-f5xc-critical-resources"];
const guidedWorkflows = rawIndex["x-f5xc-guided-workflows"];
const errorResolution = rawIndex["x-f5xc-error-resolution"];
const acronyms = rawIndex["x-f5xc-acronyms"];

const output = [
	"// Auto-generated by scripts/generate-api-spec-index.ts - DO NOT EDIT",
	"",
	`import type { ApiSpecIndex } from "./api-spec-types";`,
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
	`export const API_SPEC_BLOBS: Readonly<Record<string, string>> = {`,
	...blobEntries,
	`};`,
	"",
]
	.filter(l => l !== undefined)
	.join("\n");

await Bun.write(outputPath, output);

const outputSize = (Buffer.byteLength(output) / 1024 / 1024).toFixed(1);
console.log(
	`Generated ${path.relative(process.cwd(), outputPath)} (${processedCount} domains, ${skippedCount} skipped, ${outputSize} MB)`,
);

// Generate API catalog index
const catalog = await downloadCatalog(specsDir);
if (catalog) {
	const categories = (catalog.categories ?? []) as Array<{ name: string; displayName: string; operations: unknown[] }>;
	const catalogBlobEntries: string[] = [];
	const catalogIndexEntries: string[] = [];

	for (const cat of categories) {
		const catJson = JSON.stringify(cat);
		const catCompressed = gzipSync(Buffer.from(catJson));
		catalogBlobEntries.push(`\t${JSON.stringify(cat.name)}: ${JSON.stringify(catCompressed.toString("base64"))},`);
		catalogIndexEntries.push(
			`\t\t{ name: ${JSON.stringify(cat.name)}, displayName: ${JSON.stringify(cat.displayName)}, operationCount: ${cat.operations?.length ?? 0} },`,
		);
	}

	const catalogOutput = [
		"// Auto-generated by scripts/generate-api-spec-index.ts - DO NOT EDIT",
		"",
		`import type { ApiCatalogCategorySummary, ApiCatalogIndex } from "./api-catalog-types";`,
		"",
		`export const API_CATALOG_INDEX: ApiCatalogIndex = {`,
		`\tversion: ${JSON.stringify(catalog.version ?? "unknown")},`,
		`\tdisplayName: ${JSON.stringify(catalog.displayName ?? "F5 Distributed Cloud")},`,
		`\tservice: ${JSON.stringify(catalog.service ?? "f5xc")},`,
		`\tcategoryCount: ${categories.length},`,
		`\tauth: ${JSON.stringify(catalog.auth ?? {})},`,
		`\tdefaults: ${JSON.stringify(catalog.defaults ?? {})},`,
		`};`,
		"",
		`export const API_CATALOG_CATEGORY_SUMMARIES: ReadonlyArray<ApiCatalogCategorySummary> = [`,
		...catalogIndexEntries,
		`];`,
		"",
		`export const API_CATALOG_BLOBS: Readonly<Record<string, string>> = {`,
		...catalogBlobEntries,
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
