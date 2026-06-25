import * as fs from "node:fs/promises";
import * as path from "node:path";

const OUTPUT_FILE = path.join(import.meta.dir, "..", "src", "internal-urls", "terraform-index.generated.ts");

const LOCAL_JSON_PATH = path.resolve(
	import.meta.dir,
	"..",
	"..",
	"..",
	"..",
	"terraform-provider-xcsh",
	"docs",
	"terraform-llms-index.json",
);

const LOCAL_JSON_PATH_LEGACY = path.resolve(
	import.meta.dir,
	"..",
	"..",
	"..",
	"..",
	"terraform-provider-f5xc",
	"docs",
	"terraform-llms-index.json",
);

const GITHUB_RAW_URLS = [
	"https://raw.githubusercontent.com/f5xc-salesdemos/terraform-provider-xcsh/main/docs/terraform-llms-index.json",
	"https://raw.githubusercontent.com/f5xc-salesdemos/terraform-provider-f5xc/main/docs/terraform-llms-index.json",
];

async function loadTerraformIndex(): Promise<unknown> {
	for (const localPath of [LOCAL_JSON_PATH, LOCAL_JSON_PATH_LEGACY]) {
		const localFile = Bun.file(localPath);
		if (await localFile.exists()) {
			console.log(`Reading from local checkout: ${localPath}`);
			return localFile.json();
		}
	}

	const headers: Record<string, string> = {};
	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	if (token) {
		headers.Authorization = `token ${token}`;
	}

	for (const url of GITHUB_RAW_URLS) {
		console.log(`Local not found, fetching from ${url}`);
		const response = await fetch(url, { headers });
		if (response.ok) {
			return response.json();
		}
		console.log(`${url}: ${response.status} — trying next`);
	}
	throw new Error("Failed to fetch terraform-llms-index.json from all URLs");
}

// Backfill provider fields that older terraform-llms-index.json revisions lack, so the
// generated index always satisfies TerraformProvider regardless of which provider-repo
// revision it was fetched from (the source repo is the authority once it ships them).
const DEFAULT_CONFIG_BLOCK = 'provider "xcsh" {}';
const DEFAULT_AUTH_METHODS = [
	'REQUIRED: every .tf must contain a `provider "xcsh" {}` block. Without it Terraform errors: "Provider requires explicit configuration. Add a provider block".',
	"Configure exactly ONE auth method, via environment variables (preferred) or explicit arguments in the provider block:",
	"api_token (env XCSH_API_TOKEN) — API token authentication.",
	"api_p12_file + p12_password (env XCSH_P12_FILE + XCSH_P12_PASSWORD) — PKCS#12 certificate authentication.",
	"api_cert + api_key (env XCSH_CERT + XCSH_KEY) — PEM certificate authentication.",
	"api_url (env XCSH_API_URL) — tenant base URL without /api suffix, e.g. https://your-tenant.console.ves.volterra.io.",
];

function normalizeProvider(data: unknown): unknown {
	if (data && typeof data === "object" && "provider" in data) {
		const provider = (data as { provider: Record<string, unknown> }).provider;
		if (provider && typeof provider === "object") {
			if (typeof provider.config_block !== "string") provider.config_block = DEFAULT_CONFIG_BLOCK;
			if (!Array.isArray(provider.auth_methods)) provider.auth_methods = DEFAULT_AUTH_METHODS;
		}
	}
	return data;
}

function generateTypeScript(data: unknown): string {
	const lines = [
		"// AUTO-GENERATED — do not edit. Run `bun generate-terraform-index` to regenerate.",
		"",
		'import type { TerraformIndex } from "./terraform-types";',
		"",
		`export const TERRAFORM_INDEX: TerraformIndex = ${JSON.stringify(data, null, "\t")} as const;`,
		"",
	];
	return lines.join("\n");
}

const data = normalizeProvider(await loadTerraformIndex());
const output = generateTypeScript(data);
await fs.writeFile(OUTPUT_FILE, output, "utf-8");
await Bun.$`bunx biome format --write ${OUTPUT_FILE}`.quiet();
console.log(`Generated ${OUTPUT_FILE}`);
