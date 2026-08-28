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

const GITHUB_RAW_URL =
	"https://raw.githubusercontent.com/f5-sales-demo/terraform-provider-xcsh/main/docs/terraform-llms-index.json";
const PROVIDER_REPOSITORY = "f5-sales-demo/terraform-provider-xcsh";
const PROVIDER_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface LoadedTerraformIndex {
	data: unknown;
	providerCommit?: string;
	providerTag?: string;
}

interface FileError extends Error {
	code: string;
}

function isEnoent(error: unknown): error is FileError {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function exactProviderIndexUrl(providerCommit: string): string {
	if (!/^[0-9a-f]{40}$/.test(providerCommit)) {
		throw new Error(`TERRAFORM_PROVIDER_COMMIT must be a full lowercase Git SHA, got ${providerCommit}`);
	}
	return `https://raw.githubusercontent.com/${PROVIDER_REPOSITORY}/${providerCommit}/docs/terraform-llms-index.json`;
}

function exactProviderIdentity(env: Record<string, string | undefined>): { commit: string; tag: string } | undefined {
	const tag = env.TERRAFORM_PROVIDER_TAG;
	const commit = env.TERRAFORM_PROVIDER_COMMIT;
	if (tag === undefined && commit === undefined) return undefined;
	if (tag === undefined || commit === undefined) {
		throw new Error("TERRAFORM_PROVIDER_TAG and TERRAFORM_PROVIDER_COMMIT must be provided together");
	}
	if (!PROVIDER_TAG_PATTERN.test(tag)) {
		throw new Error(`TERRAFORM_PROVIDER_TAG must be vMAJOR.MINOR.PATCH, got ${tag}`);
	}
	if (!/^[0-9a-f]{40}$/.test(commit)) {
		throw new Error(`TERRAFORM_PROVIDER_COMMIT must be a full lowercase Git SHA, got ${commit}`);
	}
	return { commit, tag };
}

export async function loadTerraformIndex(
	env: Record<string, string | undefined> = process.env,
	fetcher: Fetcher = globalThis.fetch,
): Promise<LoadedTerraformIndex> {
	const exact = exactProviderIdentity(env);
	if (exact) {
		const exactUrl = exactProviderIndexUrl(exact.commit);
		console.log(`Fetching Terraform index from provider release ${exact.tag} at ${exact.commit}`);
		const headers: Record<string, string> = {};
		const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
		if (token) headers.Authorization = `token ${token}`;
		const response = await fetcher(exactUrl, { headers });
		if (!response.ok) {
			throw new Error(
				`Failed to fetch terraform-llms-index.json from provider release ${exact.tag} at ${exact.commit}: ${response.status} ${response.statusText}`,
			);
		}
		return { data: await response.json(), providerCommit: exact.commit, providerTag: exact.tag };
	}

	try {
		const data = await Bun.file(LOCAL_JSON_PATH).json();
		console.log(`Reading from local checkout: ${LOCAL_JSON_PATH}`);
		return { data };
	} catch (error) {
		if (!isEnoent(error)) throw error;
	}

	console.log(`Local not found, fetching from ${GITHUB_RAW_URL}`);
	const headers: Record<string, string> = {};
	const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
	if (token) {
		headers.Authorization = `token ${token}`;
	}

	const response = await fetcher(GITHUB_RAW_URL, { headers });
	if (!response.ok) {
		throw new Error(`Failed to fetch terraform-llms-index.json: ${response.status} ${response.statusText}`);
	}
	return { data: await response.json() };
}

function generateTypeScript(
	data: unknown,
	providerTag: string | undefined,
	providerCommit: string | undefined,
): string {
	const lines = [
		"// AUTO-GENERATED — do not edit. Run `bun generate-terraform-index` to regenerate.",
		providerTag && providerCommit ? `// Source: ${PROVIDER_REPOSITORY} ${providerTag} ${providerCommit}` : undefined,
		"",
		'import type { TerraformIndex } from "./terraform-types";',
		"",
		`export const TERRAFORM_INDEX: TerraformIndex = ${JSON.stringify(data, null, "\t")} as const;`,
		"",
	];
	return lines.filter(line => line !== undefined).join("\n");
}

async function main(): Promise<void> {
	const loaded = await loadTerraformIndex();
	const output = generateTypeScript(loaded.data, loaded.providerTag, loaded.providerCommit);
	await fs.writeFile(OUTPUT_FILE, output, "utf-8");
	await Bun.$`bunx biome format --write ${OUTPUT_FILE}`.quiet();
	console.log(`Generated ${OUTPUT_FILE}`);
}

if (import.meta.main) await main();
