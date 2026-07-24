/**
 * Resolver for xcsh://changes — "what changed recently in xcsh".
 *
 * xcsh's own recent history is NOT static prompt knowledge: it lives in merged
 * pull requests on the source repo. This resolver fetches them live via `gh`
 * and flags which ones landed after the running build, so the agent can answer
 * "what's new / can you do X now?" from ground truth rather than memory.
 *
 * URL forms (host = "changes"):
 * - xcsh://changes            -> recent merged PRs on main (default limit 20)
 * - xcsh://changes?limit=N    -> recent merged PRs, capped at N
 *
 * Dynamic, uncached (mirrors xcsh://about). All shelling is injected so the
 * resolver is unit-testable without a network or a `gh` binary.
 */
import { $ } from "bun";
import { formatRelativeTime, type RuntimeBuildInfo } from "./build-info-runtime";
import type { InternalResource, InternalUrl } from "./types";

export interface GhResult {
	readonly ok: boolean;
	readonly stdout: string;
	readonly stderr: string;
}

export interface MergedPr {
	readonly number: number;
	readonly title: string;
	readonly mergedAt: string;
	readonly url: string;
}

export interface ChangesDeps {
	readonly resolveBuildInfo: () => Promise<RuntimeBuildInfo>;
	readonly runGh: (args: string[]) => Promise<GhResult>;
	readonly now: () => Date;
}

export const DEFAULT_CHANGES_LIMIT = 20;
const MAX_CHANGES_LIMIT = 100;

/** Parse the JSON array emitted by `gh pr list --json ...`. Throws on malformed input. */
export function parseMergedPrs(json: string): MergedPr[] {
	const parsed = JSON.parse(json);
	if (!Array.isArray(parsed)) {
		throw new Error("Expected a JSON array of pull requests");
	}
	return parsed.map(entry => ({
		number: Number(entry.number),
		title: String(entry.title ?? ""),
		mergedAt: String(entry.mergedAt ?? ""),
		url: String(entry.url ?? ""),
	}));
}

/** Derive "owner/repo" from build info, falling back to the repo URL. */
function repoSlugOf(info: RuntimeBuildInfo): string {
	if (info.repoSlug) return info.repoSlug;
	return info.repoUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
}

function parseLimit(url: InternalUrl): number {
	const raw = url.searchParams.get("limit");
	if (!raw) return DEFAULT_CHANGES_LIMIT;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n <= 0) return DEFAULT_CHANGES_LIMIT;
	return Math.min(n, MAX_CHANGES_LIMIT);
}

function ghArgs(slug: string, limit: number): string[] {
	return [
		"pr",
		"list",
		"--repo",
		slug,
		"--base",
		"main",
		"--state",
		"merged",
		"--limit",
		String(limit),
		"--json",
		"number,title,mergedAt,url",
	];
}

/** Is this PR merged strictly after the running build's commit? Best-effort by date. */
function isNewSinceBuild(pr: MergedPr, info: RuntimeBuildInfo): boolean {
	if (!pr.mergedAt || !info.commitDate) return false;
	const merged = Date.parse(pr.mergedAt);
	const built = Date.parse(info.commitDate);
	if (Number.isNaN(merged) || Number.isNaN(built)) return false;
	return merged > built;
}

function renderHeader(info: RuntimeBuildInfo): string[] {
	return [
		"# Recent changes to xcsh",
		"",
		`Your running build: \`v${info.version}\` (commit \`${info.shortCommit || "unknown"}\`, ` +
			`committed ${info.commitDate || "unknown"}). Anything merged after that is **new to you**.`,
		"",
	];
}

const FOOTER = [
	"",
	"---",
	"To confirm a change actually works, **offer to exercise it** (run the specific command/scenario",
	"it touches) and report the evidence — do not claim it works from the PR title alone.",
	"If you find a bug or the user proposes an improvement, classify it and **offer to file** a",
	"CONTRIBUTING-compliant issue (reproduce first; no unverified claims). See `xcsh://about`.",
];

export function renderChangesDoc(info: RuntimeBuildInfo, prs: MergedPr[], nowMs: number): string {
	const lines = renderHeader(info);
	if (prs.length === 0) {
		lines.push("_No merged pull requests returned._");
	} else {
		for (const pr of prs) {
			const merged = Date.parse(pr.mergedAt);
			const when = Number.isNaN(merged) ? pr.mergedAt || "unknown" : formatRelativeTime(merged, nowMs);
			const flag = isNewSinceBuild(pr, info) ? " — 🆕 new since your build" : "";
			lines.push(`- #${pr.number} ${pr.title} (merged ${when})${flag}`);
			lines.push(`  ${pr.url}`);
		}
	}
	lines.push(...FOOTER);
	return lines.join("\n");
}

/** Rendered when `gh` cannot be run — actionable, never a thrown error. */
export function renderUnavailableDoc(info: RuntimeBuildInfo, slug: string, stderr: string): string {
	const limit = DEFAULT_CHANGES_LIMIT;
	return [
		"# Recent changes to xcsh — could not query GitHub",
		"",
		`\`gh\` was unavailable or failed${stderr ? ` (${stderr.trim()})` : ""}.`,
		"",
		"Resolve recent changes manually — do not answer about new features from memory:",
		"",
		"```",
		`gh pr list --repo ${slug} --base main --state merged --limit ${limit} --json number,title,mergedAt,url`,
		"```",
		"",
		"Or, in a local clone of the repo:",
		"",
		"```",
		"git log --oneline -n 20",
		"```",
		"",
		`Your running build: \`v${info.version}\` (commit \`${info.shortCommit || "unknown"}\`).`,
	].join("\n");
}

async function defaultRunGh(args: string[]): Promise<GhResult> {
	try {
		const res = await $`gh ${args}`.quiet().nothrow();
		return {
			ok: res.exitCode === 0,
			stdout: res.stdout.toString(),
			stderr: res.stderr.toString(),
		};
	} catch (err) {
		return { ok: false, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
	}
}

export class ChangesResolver {
	readonly #deps: ChangesDeps;

	constructor(deps: ChangesDeps) {
		this.#deps = deps;
	}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const info = await this.#deps.resolveBuildInfo();
		const slug = repoSlugOf(info);
		const limit = parseLimit(url);

		const result = await this.#deps.runGh(ghArgs(slug, limit));

		let content: string;
		if (!result.ok) {
			content = renderUnavailableDoc(info, slug, result.stderr);
		} else {
			try {
				const prs = parseMergedPrs(result.stdout);
				content = renderChangesDoc(info, prs, this.#deps.now().getTime());
			} catch (err) {
				content = renderUnavailableDoc(info, slug, err instanceof Error ? err.message : String(err));
			}
		}

		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: `xcsh://changes`,
		};
	}
}

export function createChangesResolver(deps: Partial<ChangesDeps> = {}): ChangesResolver {
	return new ChangesResolver({
		resolveBuildInfo:
			deps.resolveBuildInfo ?? (async () => (await import("./build-info-runtime")).getRuntimeBuildInfo()),
		runGh: deps.runGh ?? defaultRunGh,
		now: deps.now ?? (() => new Date()),
	});
}
