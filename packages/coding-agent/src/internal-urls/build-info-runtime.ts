import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";
import type { ContextStatus } from "../services/xcsh-context";
import { BUILD_INFO, type BuildInfo } from "./build-info.generated";

export type BuildInfoSource = "compiled" | "live-git" | "embedded-fallback";

export interface RuntimeBuildInfo extends BuildInfo {
	readonly source: BuildInfoSource;
	readonly resolvedAt: string;
}

export interface RuntimeBuildInfoDeps {
	readonly isCompiled: boolean;
	readonly gitAvailable: () => boolean;
	readonly git: (args: string[]) => Promise<string>;
	readonly now: () => Date;
}

function shortOf(sha: string): string {
	return sha ? sha.slice(0, 7) : "";
}

function commitUrl(repoUrl: string, commit: string): string {
	return commit ? `${repoUrl}/commit/${commit}` : repoUrl;
}

function firstRemoteBranch(output: string): string {
	for (const raw of output.split("\n")) {
		const line = raw.trim();
		if (!line || line.includes("->") || line === "HEAD") continue;
		const stripped = line.replace(/^origin\//, "");
		if (stripped && stripped !== "HEAD") return stripped;
	}
	return "";
}

async function liveBranch(git: RuntimeBuildInfoDeps["git"]): Promise<string> {
	const abbrev = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
	if (abbrev && abbrev !== "HEAD") return abbrev;
	const remote = await git(["branch", "-r", "--contains", "HEAD"]);
	return firstRemoteBranch(remote);
}

export async function resolveRuntimeBuildInfo(
	embedded: BuildInfo,
	deps: RuntimeBuildInfoDeps,
): Promise<RuntimeBuildInfo> {
	const resolvedAt = deps.now().toISOString();

	if (deps.isCompiled) {
		return { ...embedded, source: "compiled", resolvedAt };
	}

	if (!deps.gitAvailable()) {
		return { ...embedded, source: "embedded-fallback", resolvedAt };
	}

	const commit = (await deps.git(["rev-parse", "HEAD"])) || embedded.commit;
	const branch = (await liveBranch(deps.git)) || embedded.branch;
	const tag = await deps.git(["describe", "--exact-match", "--tags", "HEAD"]);
	const status = await deps.git(["status", "--porcelain"]);
	const dirty = status.length > 0;
	const commitDate = (await deps.git(["log", "-1", "--format=%cI", "HEAD"])) || embedded.commitDate;

	return {
		version: embedded.version,
		commit,
		shortCommit: shortOf(commit),
		branch,
		tag,
		commitDate,
		buildDate: embedded.buildDate,
		dirty,
		prNumber: embedded.prNumber,
		repoUrl: embedded.repoUrl,
		repoSlug: embedded.repoSlug,
		commitUrl: commitUrl(embedded.repoUrl, commit),
		releaseUrl: embedded.releaseUrl,
		source: "live-git",
		resolvedAt,
	};
}

/**
 * Format an epoch-ms timestamp relative to `now` as a human-readable string.
 * Buckets: sub-60s -> "just now"; 1-59 min -> "N min ago";
 * 1-23 h -> "N hour(s) ago"; 24 h+ -> "N day(s) ago".
 * Exported for testability; consumed only by renderAboutDoc.
 */
export function formatRelativeTime(epochMs: number, nowMs: number): string {
	const deltaMs = Math.max(0, nowMs - epochMs);
	if (deltaMs < 60_000) return "just now";
	if (deltaMs < 60 * 60_000) {
		const mins = Math.floor(deltaMs / 60_000);
		return `${mins} min ago`;
	}
	if (deltaMs < 24 * 60 * 60_000) {
		const hours = Math.floor(deltaMs / (60 * 60_000));
		return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	}
	const days = Math.floor(deltaMs / (24 * 60 * 60_000));
	return `${days} day${days === 1 ? "" : "s"} ago`;
}

function renderAuthStatusLine(context: ContextStatus, nowMs: number): string {
	const base = `**Auth Status:** ${context.authStatus}`;
	if (context.authLatencyMs === undefined || context.authCheckedAt === undefined) {
		return base;
	}
	const checked = formatRelativeTime(context.authCheckedAt, nowMs);
	return `${base} (latency: ${context.authLatencyMs}ms, checked: ${checked})`;
}

function renderPlatformContext(context: ContextStatus | null, nowMs: number): string {
	// xcsh can be connected via a named context OR via XCSH_API_URL / XCSH_API_TOKEN env vars.
	// In the env-only case, activeContextName is null but activeContextTenant (derived from the
	// env URL) and credentialSource ("environment") are still populated. Guard on tenant, not
	// name, so env-backed deployments see the configured state instead of the unconfigured copy.
	if (!context?.isConfigured || !context.activeContextTenant) {
		return [
			"## Current Platform Context",
			"",
			"No F5 XC context active. Run `/context create` or `/context activate` to connect.",
			"",
		].join("\n");
	}

	const authLine = renderAuthStatusLine(context, nowMs);
	const credentialLine = `**Credential Source:** ${context.credentialSource}${
		context.credentialSource === "context" && context.activeContextName ? ` (name: ${context.activeContextName})` : ""
	}`;

	return [
		"## Current Platform Context",
		"",
		`- **Tenant:** ${context.activeContextTenant}`,
		`- **Namespace:** ${context.activeContextNamespace ?? "default"}`,
		`- ${authLine}`,
		`- ${credentialLine}`,
		"",
	].join("\n");
}

export function renderAboutDoc(info: RuntimeBuildInfo, context: ContextStatus | null): string {
	return [
		"# xcsh — identity and build fingerprint",
		"",
		"You are running inside xcsh, a coworker-style CLI for F5 sales engineers:",
		"demos, docs, research, MEDDPICC, customer meeting prep, and day-to-day SE tasks.",
		"This document is the authoritative answer when the user asks about xcsh itself.",
		"",
		"## Build fingerprint",
		"",
		`- Version: \`${info.version}\``,
		`- Commit: \`${info.shortCommit || "unknown"}\` (full: \`${info.commit || "unknown"}\`)`,
		`- Branch: \`${info.branch || "unknown"}\``,
		`- Tag: ${info.tag ? `\`${info.tag}\`` : "(not a tagged build)"}`,
		`- Commit date: ${info.commitDate || "unknown"}`,
		`- Build date: ${info.buildDate || "unknown"}`,
		`- Built from dirty tree: ${info.dirty ? "yes" : "no"}`,
		`- PR that shipped this version: ${info.prNumber ? `#${info.prNumber}` : "unknown (resolve via gh if needed)"}`,
		`- Provenance source: \`${info.source}\` (resolved at ${info.resolvedAt})`,
		"",
		renderPlatformContext(context, Date.now()),
		"## Source of truth",
		"",
		`- Repository: ${info.repoUrl}`,
		`- Issues: ${info.repoUrl}/issues`,
		`- Pull requests: ${info.repoUrl}/pulls`,
		`- This commit on GitHub: ${info.commitUrl}`,
		`- Release for this version: ${info.releaseUrl}`,
		"",
		"## Product knowledge",
		"",
		"xcsh serves F5 Distributed Cloud sales engineers. Product documentation is",
		"federated across the f5-sales-demo GitHub organization. Entry point:",
		"https://f5-sales-demo.github.io/docs/llms.txt",
		"",
		"Each product repo publishes: llms.txt (index with sidebar nav), custom sets",
		"at /_llms-txt/{topic}.txt, per-page content at /{slug}.md, plus",
		"llms-small.txt (compact) and llms-full.txt (complete).",
		"",
		"## Lineage",
		"",
		"xcsh is a fork of [badlogic/pi-mono](https://github.com/badlogic/pi-mono).",
		"Upstream authors: Mario Zechner (badlogic) and contributors. Fork maintainer:",
		"f5-sales-demo. The fork adds F5 XC product knowledge,",
		"SE-specific skills, and the federated llms.txt hierarchy.",
		"",
		"## Architecture",
		"",
		"| Package | Role |",
		"|---------|------|",
		"| `coding-agent` | System prompt, tool orchestration, agent loop |",
		"| `agent` | Multi-agent coordination, subagent lifecycle |",
		"| `ai` | LLM provider abstraction (Anthropic, OpenAI, etc.) |",
		"| `tui` | Terminal UI, key bindings, themes |",
		"| `natives` | Native Bun/Rust bindings (PTY, fs, crypto) |",
		"| `stats` | Token counting, cost tracking |",
		"| `utils` | Shared utilities, config, logging |",
		"| `crates/pi-natives` | Rust native addon (compiled per-platform) |",
		"",
		"## Capabilities",
		"",
		"Sessions, MCP server/client, skills, TUI with themes, commit assistant,",
		"Python REPL, native shell/PTY, provider-agnostic LLM routing, slash commands,",
		"SSH remote execution, image generation and analysis.",
		"",
		"SE specialization: F5 XC API integration (xcsh_api, api-catalog, api-spec),",
		"F5 XC federated product docs (llms.txt hierarchy),",
		"F5 XC console browser automation (catalog_workflow_runner, xcsh://console/ workflow catalog),",
		"user/computer profiling (xcsh://user, xcsh://computer),",
		"SE-specific subagents (deal-analyst, status-operator, cli-operator, github-ops).",
		"",
		"## What to do when asked about xcsh itself",
		"",
		"1. The version above is authoritative — it is embedded at build time in this session's BUILD_INFO and also shown in the `<workstation>` header of the system prompt. Do not run `xcsh --version` to check — that reports the installed binary, which may differ from the running session after an upgrade.",
		"2. Check recent changes with `gh pr list --repo f5-sales-demo/xcsh --base main --state merged --limit 20`",
		"   or `git log --oneline -n 20` if you have a local clone. A fix may already be on `main`.",
		"3. If behavior contradicts `xcsh://…` docs, read the actual source under the repo above to determine",
		"   whether the binary is wrong or the doc is stale.",
		"4. Classify the report as one of: **bug**, **feature**, **docs-drift**, or **config/usage**.",
		"5. Offer to file it with",
		"   `gh issue create --repo f5-sales-demo/xcsh --title ... --body ...`, referencing the commit above.",
		"",
		"## Self-improvement and editable surfaces",
		"",
		`The xcsh repository above is the **source of truth** for all xcsh behavior. The directory \`~/.xcsh/\` on the user's machine is *runtime config and state* (themes, skills they installed, session data) — it is **not** xcsh's source code, and editing it will not change shipped behavior.`,
		"",
		"When the user asks how to improve or modify xcsh, classify the change against `EDITABLE_SURFACES`:",
		"",
		"- **Soft surfaces (shippable via a normal PR to the repo above):**",
		"  - System prompt fragments under `packages/coding-agent/src/prompts/`",
		"  - Tool descriptions, internal-url doc renderers, and skill definitions",
		"  - New skills, new `xcsh://` docs, keybinding defaults, theme defaults",
		"- **Hard surfaces (require a compiled release — cannot hot-patch):**",
		"  - The compiled binary, native Bun modules, and anything under `packages/*/native/`",
		"  - Startup bootstrap and the build-info generator itself",
		"",
		"The improvement workflow is always: open an issue on the repo, then a PR. The user receives changes only after a new release is built and they upgrade. Do not claim a change is live until the commit above reflects it.",
		"",
		"## What NOT to assume",
		"",
		"- Do not guess the repo URL, version, or commit — use the values above.",
		"- Do not invent recent changes; fetch them at runtime via `gh` or `git`.",
		"- Do not read this document unless the user asked about xcsh itself.",
		"",
	].join("\n");
}

// Bun-embedded module URL markers. Mirrors the native addon loader
// (see xcsh://natives-addon-loader-runtime.md) so compiled-mode detection stays
// consistent across the codebase. Update all three in lockstep if Bun changes them.
const COMPILED_URL_MARKERS = ["$bunfs", "~BUN", "%7EBUN"] as const;

export function detectCompiledRuntime(
	metaUrl: string,
	env: Readonly<Record<string, string | undefined>> = {},
): boolean {
	if (env.PI_COMPILED) return true;
	return COMPILED_URL_MARKERS.some(marker => metaUrl.includes(marker));
}

export function findGitRoot(startDir: string, fsExists: (p: string) => boolean = fs.existsSync): string | null {
	let current = path.resolve(startDir);
	while (true) {
		if (fsExists(path.join(current, ".git"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export function defaultRuntimeDeps(): RuntimeBuildInfoDeps {
	const isCompiled = detectCompiledRuntime(import.meta.url, Bun.env);
	const gitRoot = isCompiled ? null : findGitRoot(import.meta.dir);

	return {
		isCompiled,
		gitAvailable: () => gitRoot !== null,
		git: async (args: string[]): Promise<string> => {
			if (!gitRoot) return "";
			try {
				const result = await $`git ${args}`.cwd(gitRoot).quiet();
				return result.stdout.toString().trim();
			} catch {
				return "";
			}
		},
		now: () => new Date(),
	};
}

// Intentionally no cache. `xcsh://about` is invoked once per xcsh-related question
// at agent-tool-call granularity; stale fingerprints after branch-switch / dirty-tree
// changes would silently lie under source-mode. Re-resolving costs ~30ms of git subprocess
// time in source mode and ~0ms in compiled mode (where we return embedded BUILD_INFO).
export function getRuntimeBuildInfo(): Promise<RuntimeBuildInfo> {
	return resolveRuntimeBuildInfo(BUILD_INFO, defaultRuntimeDeps());
}
