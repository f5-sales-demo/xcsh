#!/usr/bin/env bun

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";
import {
	type ApiSpecReleaseIdentity,
	releaseIdentityFromEnvironment,
	validateArtifactVersion,
} from "../../../scripts/api-spec-delivery";
import { isLocalSpecsCurrent } from "./api-specs-version";
import {
	sanitizeAcmePlaceholders,
	sanitizePublicIpv4Examples,
	sanitizeSyntheticNamespaceExamples,
	serializeGeneratedValue,
} from "./sanitize-generated-content";

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

const REPO = "f5-sales-demo/api-specs-enriched";
const outputPath = path.resolve(import.meta.dir, "../src/internal-urls/api-spec-index.generated.ts");
const catalogOutputPath = path.resolve(import.meta.dir, "../src/internal-urls/api-catalog-index.generated.ts");
const releaseIdentity = releaseIdentityFromEnvironment(process.env);

function requiredSha256(value: string | undefined, field: string): string {
	if (!value || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`${field} must be a lowercase SHA-256 digest`);
	return value;
}

const expectedBundleSha256 = releaseIdentity
	? requiredSha256(process.env.API_SPECS_BUNDLE_SHA256, "API_SPECS_BUNDLE_SHA256")
	: undefined;
const expectedCatalogSha256 = releaseIdentity
	? requiredSha256(process.env.API_SPECS_CATALOG_SHA256, "API_SPECS_CATALOG_SHA256")
	: undefined;

/** Domains reserved for documentation by RFC 2606 / RFC 6761. */
const RESERVED_EMAIL_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

/**
 * Upstream specs illustrate contact fields with addresses at real domains — `gmail.com`, `f5.com`,
 * `company.com`. At least one is a real person's work address rather than a placeholder, and
 * STYLE_GUIDE.md allows only a placeholder name at a reserved domain. Replace the whole address, not
 * just the domain: keeping the local part would keep the person's name (#2659).
 */
function sanitizeEmails(text: string): string {
	// The lookbehind skips URL userinfo (`https://token:secret@host`), which is not a contact address.
	return text.replace(/(?<![:/])\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]+)\b/g, (whole, domain) =>
		RESERVED_EMAIL_DOMAINS.has(String(domain).toLowerCase()) ? whole : "dana@example.com",
	);
}

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

async function downloadFromRelease(exactTag?: string, expectedSha256?: string): Promise<string> {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-specs-"));
	downloadedTmpDir = tmpDir;
	const tag = exactTag ?? (await resolveLatestTag());
	const zipName = `f5xc-api-specs-${tag}.zip`;
	const downloadUrl = `https://github.com/${REPO}/releases/download/${tag}/${zipName}`;

	console.log(`Downloading API specs from ${downloadUrl}...`);
	const response = await fetchWithRetry(downloadUrl, { redirect: "follow" });
	if (!response.ok) {
		throw new Error(`Failed to download release: ${response.status} ${response.statusText}`);
	}

	const zipPath = path.join(tmpDir, zipName);
	const buffer = Buffer.from(await response.arrayBuffer());
	if (expectedSha256 && new Bun.CryptoHasher("sha256").update(buffer).digest("hex") !== expectedSha256) {
		throw new Error(`Downloaded ${zipName} differs from its immutable publication receipt`);
	}
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

function readLocalSpecsVersion(specsDir: string): string | undefined {
	try {
		const index = JSON.parse(fs.readFileSync(path.join(specsDir, "index.json"), "utf-8")) as { version?: string };
		return index.version;
	} catch {
		return undefined;
	}
}

async function findSpecsDir(identity: ApiSpecReleaseIdentity | undefined): Promise<string> {
	if (identity) {
		return downloadFromRelease(identity.releaseTag, expectedBundleSha256);
	}

	const envDir = process.env.API_SPECS_DIR;
	if (envDir && fs.existsSync(envDir)) {
		// Explicit override — the caller is responsible for its freshness.
		return envDir;
	}

	const localCheckout = path.resolve(import.meta.dir, "../../../../api-specs-enriched/docs/specifications/api");
	if (fs.existsSync(localCheckout)) {
		// Only build from the local checkout when it matches the latest release, so a
		// stale checkout cannot silently pin the build to old specs. If GitHub is
		// unreachable (offline dev), fall back to the local checkout with a warning.
		try {
			const latestTag = await resolveLatestTag();
			const localVersion = readLocalSpecsVersion(localCheckout);
			if (isLocalSpecsCurrent(localVersion, latestTag)) {
				return localCheckout;
			}
			console.warn(
				`Local api-specs-enriched checkout is stale (local ${localVersion ?? "unknown"} != latest ${latestTag}); building against the latest release instead.`,
			);
		} catch (err) {
			console.warn(
				`Could not verify the latest api-specs version (${err instanceof Error ? err.message : err}); using the local checkout.`,
			);
			return localCheckout;
		}
	}

	return downloadFromRelease();
}

async function downloadJsonReleaseAsset(
	tag: string,
	assetName: string,
	required: boolean,
	expectedSha256?: string,
): Promise<Record<string, unknown> | null> {
	const url = `https://github.com/${REPO}/releases/download/${tag}/${assetName}`;
	console.log(`Downloading ${assetName} from ${url}...`);
	try {
		const response = await fetchWithRetry(url, { redirect: "follow" });
		if (!response.ok) {
			if (required) {
				throw new Error(`Required ${assetName} is absent from release ${tag}: HTTP ${response.status}`);
			}
			console.warn(`${assetName} not found (${response.status}), skipping generation`);
			return null;
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (expectedSha256 && new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== expectedSha256) {
			throw new Error(`Downloaded ${assetName} differs from its immutable publication receipt`);
		}
		return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
	} catch (error) {
		if (required) throw error;
		console.warn(`Failed to download ${assetName}: ${error instanceof Error ? error.message : error}`);
		return null;
	}
}

async function downloadCatalog(
	specsDir: string,
	identity: ApiSpecReleaseIdentity | undefined,
): Promise<Record<string, unknown> | null> {
	if (identity) {
		return downloadJsonReleaseAsset(identity.releaseTag, "api-catalog.json", true, expectedCatalogSha256);
	}

	const catalogPath = path.join(specsDir, "api-catalog.json");
	if (fs.existsSync(catalogPath)) {
		return JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
	}

	return downloadJsonReleaseAsset(await resolveLatestTag(), "api-catalog.json", false);
}

async function downloadValidation(
	specsDir: string,
	identity: ApiSpecReleaseIdentity | undefined,
): Promise<Record<string, unknown> | null> {
	const validationPath = path.join(specsDir, "validation.json");
	if (fs.existsSync(validationPath)) {
		return JSON.parse(fs.readFileSync(validationPath, "utf-8"));
	}
	if (identity) {
		throw new Error(`Required validation.json is absent from the ${identity.releaseTag} spec bundle`);
	}

	return downloadJsonReleaseAsset(await resolveLatestTag(), "validation.json", false);
}

function serializeEnrichment(key: string, value: unknown): string | undefined {
	if (!value) return undefined;
	return `\t${key}: ${serializeGeneratedValue(value)},`;
}

let downloadedTmpDir: string | null = null;

if (!releaseIdentity && fs.existsSync(outputPath) && fs.existsSync(catalogOutputPath) && process.env.CI) {
	console.log("Generated spec files already exist in CI — skipping regeneration.");
	process.exit(0);
}

const specsDir = await findSpecsDir(releaseIdentity);
console.log(`Reading specs from: ${specsDir}`);

const indexPath = path.join(specsDir, "index.json");
if (!fs.existsSync(indexPath)) {
	console.error(`index.json not found at: ${indexPath}`);
	process.exit(1);
}

const rawIndex: RawIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
if (releaseIdentity) validateArtifactVersion(rawIndex, releaseIdentity, "index.json");

const catalog = await downloadCatalog(specsDir, releaseIdentity);
if (releaseIdentity) validateArtifactVersion(catalog, releaseIdentity, "api-catalog.json");
const validation = await downloadValidation(specsDir, releaseIdentity);

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

	specDataEntries.push(`\t${JSON.stringify(entry.domain)}: ${serializeGeneratedValue(specJson)},`);
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
			`\t${JSON.stringify(entry.domain)}: ${serializeGeneratedValue({ operationMeta, schemaEnrichments })},`,
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
				`export const API_VALIDATION_DATA: Readonly<Record<string, ApiSpecValidationResourceEntry>> = ${serializeGeneratedValue((validation as { required_fields?: { resources?: Record<string, unknown> } }).required_fields?.resources ?? {})};`,
				"",
			]
		: [`export const API_VALIDATION_DATA: Readonly<Record<string, ApiSpecValidationResourceEntry>> = {};`, ""]),
]
	.filter(l => l !== undefined)
	.join("\n");

await Bun.write(
	outputPath,
	sanitizeSyntheticNamespaceExamples(sanitizePublicIpv4Examples(sanitizeEmails(sanitizeAcmePlaceholders(output)))),
);

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
		catalogDataEntries.push(`\t${JSON.stringify(cat.name)}: ${serializeGeneratedValue(cat)},`);
		catalogIndexEntries.push(
			`\t\t${serializeGeneratedValue({
				name: cat.name,
				displayName: cat.displayName,
				operationCount: cat.operations?.length ?? 0,
			})},`,
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
		`\tauth: ${serializeGeneratedValue(catalog.auth ?? {})},`,
		`\tdefaults: ${serializeGeneratedValue(catalog.defaults ?? {})},`,
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

	await Bun.write(
		catalogOutputPath,
		sanitizePublicIpv4Examples(sanitizeEmails(sanitizeAcmePlaceholders(catalogOutput))),
	);
	const catalogSize = (Buffer.byteLength(catalogOutput) / 1024 / 1024).toFixed(1);
	console.log(
		`Generated ${path.relative(process.cwd(), catalogOutputPath)} (${categories.length} categories, ${catalogSize} MB)`,
	);
}

if (downloadedTmpDir) {
	fs.rmSync(downloadedTmpDir, { recursive: true, force: true });
}
