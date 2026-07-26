// Embeds the Customer Edge Site CLI command surface, so the agent knows it without a
// network round trip.
//
// The source of truth is sitecli/catalog.json in f5-sales-demo/mcn, which is produced
// by capturing the node's own self-describing catalog rather than transcribed from any
// document. Resolution order matches generate-terraform-index.ts and
// generate-branding-index.ts: a sibling checkout first, then raw.githubusercontent.
import * as fs from "node:fs/promises";
import * as path from "node:path";

const OUTPUT_FILE = path.join(import.meta.dir, "..", "src", "internal-urls", "sitecli-index.generated.ts");

const LOCAL_CATALOG_PATH = path.resolve(import.meta.dir, "..", "..", "..", "..", "mcn", "sitecli", "catalog.json");

const GITHUB_RAW_URL = "https://raw.githubusercontent.com/f5-sales-demo/mcn/main/sitecli/catalog.json";

/** Shape of sitecli/catalog.json as committed by mcn. */
interface SiteCliCatalog {
	build: string;
	source?: { site?: string; node?: string };
	commands: Record<
		string,
		{
			category: string;
			/** "ExecUser" (read-only) or "Exec" (privileged, mutates or reads a state marker). */
			tier: string;
			/** Illustrative only — often a placeholder such as " container-id". */
			example?: string;
			/** "GLOBAL" means a dedicated GET endpoint, NOT reachable via exec-user. */
			scope?: string;
		}
	>;
}

async function loadCatalog(): Promise<SiteCliCatalog> {
	const localFile = Bun.file(LOCAL_CATALOG_PATH);
	if (await localFile.exists()) {
		console.log(`Reading from local checkout: ${LOCAL_CATALOG_PATH}`);
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
		throw new Error(`Failed to fetch sitecli catalog.json: ${response.status} ${response.statusText}`);
	}
	return (await response.json()) as SiteCliCatalog;
}

/**
 * Which endpoint a command must be sent to. This is derived here rather than left to
 * the caller because getting it wrong returns "command not supported" — the same
 * message as a command that does not exist — so the mistake reads as a missing
 * command rather than a wrong transport.
 */
function transportFor(entry: { tier: string; scope?: string }): "global-get" | "exec-user" | "exec" {
	if (entry.scope === "GLOBAL") return "global-get";
	return entry.tier === "Exec" ? "exec" : "exec-user";
}

function generateTypeScript(catalog: SiteCliCatalog): string {
	const commands = Object.fromEntries(
		Object.entries(catalog.commands)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, entry]) => [
				name,
				{
					category: entry.category,
					tier: entry.tier,
					transport: transportFor(entry),
					mutating: entry.tier === "Exec",
					...(entry.example ? { example: entry.example.trim() } : {}),
					...(entry.scope ? { scope: entry.scope } : {}),
				},
			]),
	);

	return `${[
		"// AUTO-GENERATED — do not edit. Run `bun generate-sitecli-index` to regenerate.",
		"//",
		"// Source: f5-sales-demo/mcn sitecli/catalog.json, captured from a live Customer Edge.",
		"// The command surface depends on the node software build, so SITECLI_BUILD records",
		"// which build this describes.",
		"",
		`export const SITECLI_BUILD = ${JSON.stringify(catalog.build)};`,
		"",
		`export const SITECLI_SOURCE = ${JSON.stringify(catalog.source ?? {}, null, 2)} as const;`,
		"",
		`export const SITECLI_COMMANDS = ${JSON.stringify(commands, null, 2)} as const;`,
		"",
	].join("\n")}`;
}

const catalog = await loadCatalog();
const output = generateTypeScript(catalog);
await fs.writeFile(OUTPUT_FILE, output, "utf-8");
await Bun.$`bunx biome format --write ${OUTPUT_FILE}`.quiet();
console.log(`Generated ${OUTPUT_FILE} (${Object.keys(catalog.commands).length} commands, build ${catalog.build})`);
