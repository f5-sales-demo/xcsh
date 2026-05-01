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

/**
 * Finds the operationId schema components (e.g., 'dns_zone', 'views.forward_proxy_policy')
 * that correspond to a given resource name by matching path segments.
 */
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

interface IndexEntry {
	domain: string;
	title: string;
	description: string;
	"x-f5xc-description-short": string;
	file: string;
	path_count: number;
	schema_count: number;
	"x-f5xc-complexity": string;
	"x-f5xc-category": string;
	"x-f5xc-use-cases"?: string[];
	"x-f5xc-related-domains"?: string[];
	"x-f5xc-primary-resources"?: Array<{ name: string; description: string }>;
}

interface RawIndex {
	version: string;
	timestamp: string;
	specifications: IndexEntry[];
}

const REPO = "f5xc-salesdemos/api-specs-enriched";
const PINNED_TAG = "v2.1.62";
const outputPath = path.resolve(import.meta.dir, "../src/internal-urls/api-spec-index.generated.ts");

async function downloadFromRelease(): Promise<string> {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-specs-"));
	downloadedTmpDir = tmpDir;
	const tag = process.env.API_SPECS_TAG ?? PINNED_TAG;
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
		const schemaComponents = findResourceSchemaComponents(r.name, specJson.paths ?? {});
		const scStr = schemaComponents.length > 0 ? `, schemaComponents: ${JSON.stringify(schemaComponents)}` : "";
		return `\t\t\t{ name: ${JSON.stringify(r.name)}, description: ${JSON.stringify(r.description)}${scStr} },`;
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
			"\t\t},",
		]
			.filter(Boolean)
			.join("\n"),
	);

	blobEntries.push(`\t${JSON.stringify(entry.domain)}: ${JSON.stringify(b64)},`);
	processedCount++;
}

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
	`};`,
	"",
	`export const API_SPEC_BLOBS: Readonly<Record<string, string>> = {`,
	...blobEntries,
	`};`,
	"",
].join("\n");

await Bun.write(outputPath, output);

const outputSize = (Buffer.byteLength(output) / 1024 / 1024).toFixed(1);
console.log(
	`Generated ${path.relative(process.cwd(), outputPath)} (${processedCount} domains, ${skippedCount} skipped, ${outputSize} MB)`,
);

if (downloadedTmpDir) {
	fs.rmSync(downloadedTmpDir, { recursive: true, force: true });
}
