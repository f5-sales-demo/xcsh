// Behavioral deprecation guardrails, derived from the single source of truth
// (api-specs-enriched/config/branding.yaml → branding-index.generated.ts).
//
// This module is the ONE seam every surface consumes so deprecation facts are
// authored once and never hand-duplicated:
//   - the always-on system prompt (renderDeprecationGuardrails)
//   - the xcsh://branding/* protocol (via xcsh-protocol.ts, same generated data)
//   - the CLI-Quick-Start renderer (isDisallowedCliCommand / getDeprecatedClis)

import { BRANDING_DEPRECATIONS } from "./internal-urls/branding-index.generated";

interface DeprecationEntry {
	deprecated: Record<string, string>;
	canonical: Record<string, string>;
}

const DEPRECATIONS = BRANDING_DEPRECATIONS as unknown as Record<string, DeprecationEntry>;

/** Markers that identify a command as targeting the F5 XC API. */
const F5XC_API_MARKERS = [
	"f5xc_api_url",
	"f5xc_api_token",
	"apitoken",
	".volterra.io",
	".volterra.us",
	"console.ves",
	"/api/config/",
	"/api/data/",
	"/api/web/",
	"/api/shape/",
	"/api/ml/",
	"/api/register/",
];

// xcsh-native guidance substituted wherever a deprecated command would appear.
// Intentionally does NOT echo the deprecated tool name — the substitution exists
// precisely so that name never reaches the user through this surface.
export const XCSH_NATIVE_API_GUIDANCE =
	"Use the `xcsh_api` tool for F5 Distributed Cloud API calls — the spec's legacy CLI example is not supported in xcsh.";

/** Deprecated CLI commands, sourced from branding deprecation data (e.g. ["vesctl"]). */
export function getDeprecatedClis(): string[] {
	const clis = new Set<string>();
	for (const entry of Object.values(DEPRECATIONS)) {
		const command = entry.deprecated?.command;
		if (command) clis.add(command.trim().toLowerCase());
	}
	return [...clis];
}

/**
 * True if a command must never be surfaced as an instruction: it invokes a
 * deprecated CLI (e.g. vesctl), or it is a raw `curl` against the F5 XC API.
 */
export function isDisallowedCliCommand(command: string): boolean {
	const lower = command.trim().toLowerCase();
	if (!lower) return false;
	const leadingToken = lower.split(/\s+/)[0] ?? "";
	if (getDeprecatedClis().includes(leadingToken)) return true;
	if (leadingToken === "curl" && F5XC_API_MARKERS.some(marker => lower.includes(marker))) return true;
	return false;
}

/**
 * Concise, always-on deprecation block for the system prompt. Concrete values
 * come from the embedded branding data; the behavioral rules are stable prose.
 */
export function renderDeprecationGuardrails(): string {
	const cli = DEPRECATIONS.cli;
	const apiDocs = DEPRECATIONS.api_documentation;
	const brand = DEPRECATIONS.product_brand;

	const vesctl = cli?.deprecated.command ?? "vesctl";
	const xcshCmd = cli?.canonical.command ?? "xcsh";
	const legacyApiUrl = apiDocs?.deprecated.url ?? "https://docs.cloud.f5.com/docs-v2/api";
	const enrichedUrl = apiDocs?.canonical.url ?? "https://f5-sales-demo.github.io/api-specs-enriched/en/";
	const deadBrand = brand?.deprecated.name ?? "Volterra";
	const currentBrand = brand?.canonical.name ?? "F5 Distributed Cloud";

	return [
		"These deprecations are non-negotiable. Full detail lives at `xcsh://branding` and `xcsh://branding/volterra`, but the rules below apply even when that protocol is never consulted.",
		"",
		`- **Never use \`${vesctl}\`.** It is the abandoned, unsupported legacy CLI; \`${xcshCmd}\` is its modern replacement. Never propose, generate, or run \`${vesctl}\`. For F5 XC API calls use the \`xcsh_api\` tool (never raw \`curl\`); for console automation use \`catalog_workflow_runner\`.`,
		`- **The legacy API docs are deprecated.** Never link or fetch \`${legacyApiUrl}\`; the canonical human-facing API documentation site is \`${enrichedUrl}\`. For your own API work you rarely need either — the enriched OpenAPI specs ship embedded in this binary: use \`xcsh://api-catalog/\` (operations/CRUD) and \`xcsh://api-spec/\` (schemas) per the routing rules above.`,
		`- **"${deadBrand}" is a retired brand name.** The product is **${currentBrand}**; never write "${deadBrand}" as a product name or recommend ${deadBrand}-labeled tooling. BUT \`volterra_*\` API keys, \`*.volterra.io\`/\`*.volterra.us\` hostnames, and schema identifiers are **required functional identifiers** — use them verbatim, exactly as the API expects. Only the brand name is dead, not the identifiers.`,
	].join("\n");
}
