import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";
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

export function renderAboutDoc(info: RuntimeBuildInfo): string {
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
		"## Source of truth",
		"",
		`- Repository: ${info.repoUrl}`,
		`- Issues: ${info.repoUrl}/issues`,
		`- Pull requests: ${info.repoUrl}/pulls`,
		`- This commit on GitHub: ${info.commitUrl}`,
		`- Release for this version: ${info.releaseUrl}`,
		"",
		"## What to do when asked about xcsh itself",
		"",
		"1. Confirm the user is running the version above. If unsure, ask them to run `xcsh --version`.",
		"2. Check recent changes with `gh pr list --repo f5xc-salesdemos/xcsh --base main --state merged --limit 20`",
		"   or `git log --oneline -n 20` if you have a local clone. A fix may already be on `main`.",
		"3. If behavior contradicts `xcsh://…` docs, read the actual source under the repo above to determine",
		"   whether the binary is wrong or the doc is stale.",
		"4. Classify the report as one of: **bug**, **feature**, **docs-drift**, or **config/usage**.",
		"5. Offer to file it with",
		"   `gh issue create --repo f5xc-salesdemos/xcsh --title ... --body ...`, referencing the commit above.",
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
