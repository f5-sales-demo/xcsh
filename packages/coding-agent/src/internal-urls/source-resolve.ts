/**
 * Resolver for xcsh://source — "where is X implemented in my own source?".
 *
 * A curated capability -> source-path map plus the soft/hard editable-surface
 * rule, so the agent can point at concrete files (browsable at the exact
 * running commit) instead of guessing. Complements xcsh://about (identity)
 * and xcsh://changes (recent history).
 *
 * URL form (host = "source"):
 * - xcsh://source -> capability map + editable-surface classification
 */
import type { RuntimeBuildInfo } from "./build-info-runtime";
import type { InternalResource, InternalUrl } from "./types";

export interface CapabilityEntry {
	readonly capability: string;
	readonly path: string;
	readonly note: string;
}

export interface SourceDeps {
	readonly resolveBuildInfo: () => Promise<RuntimeBuildInfo>;
}

/**
 * Capability -> path index. Paths are repo-relative and stable; each is rendered
 * as a link to the exact running commit so "read the source" lands on ground truth.
 */
export const CAPABILITY_MAP: readonly CapabilityEntry[] = [
	{
		capability: "Identity, reflexes, and guardrails (the system prompt itself)",
		path: "packages/coding-agent/src/prompts/system/system-prompt.md",
		note: "The <role>, <self-awareness>, and internal-URL hint content shipped to every session.",
	},
	{
		capability: "System-prompt assembly (composition, conditional sections)",
		path: "packages/coding-agent/src/system-prompt.ts",
		note: "buildSystemPrompt() renders the template against runtime data.",
	},
	{
		capability: "xcsh:// resolver layer (all internal URLs)",
		path: "packages/coding-agent/src/internal-urls/",
		note: "router.ts dispatches by scheme; *-resolve.ts handle each host.",
	},
	{
		capability: "Identity / build fingerprint (xcsh://about)",
		path: "packages/coding-agent/src/internal-urls/build-info-runtime.ts",
		note: "renderAboutDoc() + git-backed build info.",
	},
	{
		capability: "Recent changes (xcsh://changes)",
		path: "packages/coding-agent/src/internal-urls/changes-resolve.ts",
		note: "Live merged-PR history via gh; flags what is new since your build.",
	},
	{
		capability: "This source map (xcsh://source)",
		path: "packages/coding-agent/src/internal-urls/source-resolve.ts",
		note: "The file you are reading the output of.",
	},
	{
		capability: "CLI entrypoint / compiled binary",
		path: "packages/coding-agent/src/cli.ts",
		note: "Bun-compiled to dist/xcsh (bun build --compile).",
	},
	{
		capability: "Tools (bash, edit, browser, xcsh_api, catalog_workflow_runner, ...)",
		path: "packages/coding-agent/src/tools/",
		note: "Tool implementations and their prompt fragments.",
	},
	{
		capability: "SE skills (account-planning, competitive, demo-components, terraform-provider, ...)",
		path: ".xcsh/skills/",
		note: "SKILL.md-defined capabilities loaded on demand.",
	},
	{
		capability: "F5 XC API catalog & spec (xcsh://api-catalog, xcsh://api-spec)",
		path: "packages/coding-agent/src/internal-urls/api-catalog-resolve.ts",
		note: "Generated indexes sourced from api-specs-enriched.",
	},
	{
		capability: "Console browser automation (xcsh://console, catalog_workflow_runner)",
		path: "packages/coding-agent/src/internal-urls/console-resolve.ts",
		note: "Deterministic UI workflows driven through the Chrome extension.",
	},
	{
		capability: "Plugin / marketplace subsystem",
		path: "packages/coding-agent/src/extensibility/plugins/marketplace/",
		note: "Installs from f5-sales-demo/marketplace; see also cli/plugin-cli.ts.",
	},
	{
		capability: "Release chain (version bump -> tag -> Homebrew/npm)",
		path: "scripts/release.ts",
		note: "Paired with .github/workflows/ci.yml and tag-on-version-bump.yml.",
	},
	{
		capability: "Native addon (Rust; a HARD surface — needs a compiled release)",
		path: "crates/pi-natives/",
		note: "Built via packages/natives; cannot be hot-patched by a prompt/skill PR.",
	},
	{
		capability: "Contribution process (issue -> worktree -> TDD -> PR)",
		path: "CONTRIBUTING.md",
		note: "The rules for any change: no unverified claims, evidence required.",
	},
];

function blobUrl(info: RuntimeBuildInfo, relPath: string): string {
	const ref = info.commit || info.branch || "main";
	return `${info.repoUrl}/blob/${ref}/${relPath}`;
}

export function renderSourceDoc(info: RuntimeBuildInfo): string {
	const lines: string[] = [
		"# xcsh source map — where capabilities live",
		"",
		`Repository (source of truth): ${info.repoUrl}`,
		`Running build: \`v${info.version}\` (commit \`${info.shortCommit || "unknown"}\`). Links below point at that commit.`,
		"",
		"| Capability | Source | Note |",
		"|------------|--------|------|",
	];
	for (const e of CAPABILITY_MAP) {
		lines.push(`| ${e.capability} | [\`${e.path}\`](${blobUrl(info, e.path)}) | ${e.note} |`);
	}
	lines.push(
		"",
		"## Editable surfaces",
		"",
		"- **Soft surfaces** (shippable via a normal PR — behavior changes on next release):",
		"  system prompt fragments, tool descriptions, internal-URL doc renderers, skills, new",
		"  `xcsh://` docs, keybinding/theme defaults.",
		"- **Hard surfaces** (require a compiled release — cannot hot-patch):",
		"  the compiled binary, native Bun/Rust modules under `crates/` and `packages/*/native/`,",
		"  startup bootstrap, and the build-info generator.",
		"",
		"`~/.xcsh/` on the machine is runtime config/state — **not** xcsh's source; editing it changes nothing shipped.",
		"",
		"To improve xcsh: open an issue, then a PR (see `CONTRIBUTING.md`). A change is not live until a",
		"release is built and installed — do not claim it is. For recent history use `xcsh://changes`;",
		"for identity/version use `xcsh://about`.",
	);
	return lines.join("\n");
}

export class SourceResolver {
	readonly #deps: SourceDeps;

	constructor(deps: SourceDeps) {
		this.#deps = deps;
	}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const info = await this.#deps.resolveBuildInfo();
		const content = renderSourceDoc(info);
		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: `xcsh://source`,
		};
	}
}

export function createSourceResolver(deps: Partial<SourceDeps> = {}): SourceResolver {
	return new SourceResolver({
		resolveBuildInfo:
			deps.resolveBuildInfo ?? (async () => (await import("./build-info-runtime")).getRuntimeBuildInfo()),
	});
}
