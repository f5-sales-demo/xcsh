import * as fs from "node:fs/promises";
import * as path from "node:path";
import YAML from "yaml";

const OUTPUT_FILE = path.join(import.meta.dir, "..", "src", "internal-urls", "branding-index.generated.ts");

const LOCAL_BRANDING_PATH = path.resolve(
	import.meta.dir,
	"..",
	"..",
	"..",
	"..",
	"api-specs-enriched",
	"config",
	"branding.yaml",
);

const GITHUB_RAW_URL = "https://raw.githubusercontent.com/f5xc-salesdemos/api-specs-enriched/main/config/branding.yaml";

interface BrandingCanonical {
	long_form: string;
	description?: string;
	legacy_names: string[];
	comparable_to: string[];
}

interface DeprecationEntry {
	deprecated: Record<string, string>;
	canonical: Record<string, string>;
	required_providers_block?: string;
}

interface BrandingConfig {
	version: string;
	description: string;
	canonical: Record<string, BrandingCanonical>;
	deprecations: Record<string, DeprecationEntry>;
	glossary: Record<string, Record<string, string>>;
	domain_branding: Record<string, Record<string, string>>;
}

async function loadBrandingYaml(): Promise<BrandingConfig> {
	const localFile = Bun.file(LOCAL_BRANDING_PATH);
	if (await localFile.exists()) {
		const content = await localFile.text();
		return YAML.parse(content) as BrandingConfig;
	}

	const response = await fetch(GITHUB_RAW_URL);
	if (!response.ok) {
		throw new Error(`Failed to fetch branding.yaml: ${response.status}`);
	}
	return YAML.parse(await response.text()) as BrandingConfig;
}

function generateTypeScript(config: BrandingConfig): string {
	const lines: string[] = [
		"// AUTO-GENERATED — do not edit. Run `bun generate-branding-index` to regenerate.",
		"",
		`export const BRANDING_VERSION = ${JSON.stringify(config.version)};`,
		"",
		`export const BRANDING_CANONICAL = ${JSON.stringify(config.canonical, null, 2)} as const;`,
		"",
		`export const BRANDING_DEPRECATIONS = ${JSON.stringify(config.deprecations, null, 2)} as const;`,
		"",
		`export const BRANDING_GLOSSARY = ${JSON.stringify(config.glossary, null, 2)} as const;`,
		"",
		`export const BRANDING_DOMAIN = ${JSON.stringify(config.domain_branding, null, 2)} as const;`,
		"",
	];

	return lines.join("\n");
}

const config = await loadBrandingYaml();
const output = generateTypeScript(config);
await fs.writeFile(OUTPUT_FILE, output, "utf-8");
await Bun.$`bunx biome format --write ${OUTPUT_FILE}`.quiet();
console.log(`Generated ${OUTPUT_FILE}`);
