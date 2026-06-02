import * as fs from "node:fs/promises";
import * as path from "node:path";

const OUTPUT_FILE = path.join(import.meta.dir, "..", "src", "internal-urls", "terraform-index.generated.ts");

const LOCAL_JSON_PATH = path.resolve(
	import.meta.dir,
	"..",
	"..",
	"..",
	"..",
	"terraform-provider-f5xc",
	"docs",
	"terraform-llms-index.json",
);

const GITHUB_RAW_URL =
	"https://raw.githubusercontent.com/f5xc-salesdemos/terraform-provider-f5xc/main/docs/terraform-llms-index.json";

async function loadTerraformIndex(): Promise<unknown> {
	const localFile = Bun.file(LOCAL_JSON_PATH);
	if (await localFile.exists()) {
		console.log(`Reading from local checkout: ${LOCAL_JSON_PATH}`);
		return localFile.json();
	}

	console.log(`Local not found, fetching from ${GITHUB_RAW_URL}`);
	const headers: Record<string, string> = {};
	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	if (token) {
		headers.Authorization = `token ${token}`;
	}

	const response = await fetch(GITHUB_RAW_URL, { headers });
	if (!response.ok) {
		throw new Error(`Failed to fetch terraform-llms-index.json: ${response.status} ${response.statusText}`);
	}
	return response.json();
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

const data = await loadTerraformIndex();
const output = generateTypeScript(data);
await fs.writeFile(OUTPUT_FILE, output, "utf-8");
await Bun.$`bunx biome format --write ${OUTPUT_FILE}`.quiet();
console.log(`Generated ${OUTPUT_FILE}`);
