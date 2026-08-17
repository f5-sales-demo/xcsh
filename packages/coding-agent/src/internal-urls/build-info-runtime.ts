import * as fs from "node:fs";
import * as path from "node:path";
import { prompt } from "@f5-sales-demo/pi-utils";
import { $ } from "bun";
import aboutTemplate from "../prompts/internal-urls/about.md" with { type: "text" };
import activeModelTemplate from "../prompts/internal-urls/active-model.md" with { type: "text" };
import containmentTemplate from "../prompts/internal-urls/containment.md" with { type: "text" };
import type { ContainmentStatus } from "../sandbox/containment";
import type { ContextStatus } from "../services/xcsh-context";
import type { ActiveModelSnapshot } from "../session/active-model";
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

/**
 * Render the active-model section from its template.
 *
 * The text lives in a static `.md` with Handlebars rather than being assembled here, per AGENTS.md:
 * prompts are not built in code. It is agent-directed prose — it tells the model to trust this
 * section and not to probe itself by spawning a subprocess — so it belongs with the other prompts.
 */
function renderActiveModel(model: ActiveModelSnapshot | null): string {
	return prompt.render(activeModelTemplate, { model });
}

/**
 * What is enforcing the filesystem boundary, and what that does and does not guarantee.
 *
 * Stated here because two sessions can look identical and offer very different guarantees: with an OS
 * backend a path is checked where it is opened and the spelling cannot matter, while without one the
 * only check reads the command text. An operator has no other way to tell which they have.
 */
function renderContainment(containment: ContainmentStatus | null): string {
	if (!containment) return "";
	// `landlock` is derived rather than another field on the status, because the template needs a
	// boolean and Handlebars cannot compare strings. It gates the Linux-only costs — unlistable split
	// directories, no setuid, no interactive terminal — which are true of that backend and no other.
	return prompt.render(containmentTemplate, {
		containment: { ...containment, landlock: containment.backend === "landlock" },
	});
}

export function renderAboutDoc(
	info: RuntimeBuildInfo,
	context: ContextStatus | null,
	model: ActiveModelSnapshot | null,
	containment: ContainmentStatus | null,
): string {
	return prompt.render(aboutTemplate, {
		info,
		platformContext: renderPlatformContext(context, Date.now()),
		activeModel: renderActiveModel(model),
		containment: renderContainment(containment),
	});
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
