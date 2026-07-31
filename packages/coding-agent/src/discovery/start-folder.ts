/**
 * What kind of directory this xcsh instance was started in.
 *
 * The binary maps to a session by its start folder, and those folders are not the same
 * kind of thing. Some are GitHub checkouts where version control is the point. Some hold
 * tenant automations, lab state, credentials and troubleshooting captures that must never
 * reach a repository. Without this distinction the agent will helpfully offer to `git init`
 * the second kind.
 *
 * `classifyRepo` in ../internal-urls/fleet-resolve.ts cannot answer it: it collapses "not a
 * repository at all" and "a repository in an unrecognised org" into the same unclassified
 * verdict, which is precisely the distinction needed here.
 */
import { parseGitHubRepo } from "../modes/components/status-line/git-utils";
import * as git from "../utils/git";

export type StartFolderKind =
	/** In a repository with a GitHub remote. Git and GitHub work are both in scope. */
	| "github"
	/** In a repository, but not one on GitHub. Version control is fine; GitHub actions are not. */
	| "git"
	/** Not in a repository. May hold secrets, so publishing it is never volunteered. */
	| "plain";

export interface StartFolder {
	readonly kind: StartFolderKind;
	/** `owner/repo`, present only when `kind` is `"github"`. */
	readonly slug?: string;
	/**
	 * The start folder is itself git-ignored: inside a repository, but deliberately
	 * excluded from it. Set only when it is — absent reads as "not ignored".
	 */
	readonly ignored?: true;
}

/** Injected so the branches are testable without a real repository on disk. */
export interface StartFolderDeps {
	/** Repository root for `cwd`, or null when `cwd` is not in one. */
	repoRoot(cwd: string, signal?: AbortSignal): Promise<string | null>;
	/** URL of the `origin` remote, or null when there is none. */
	originUrl(cwd: string, signal?: AbortSignal): Promise<string | null>;
	/** Whether `cwd` itself is excluded by gitignore rules. */
	isIgnored(cwd: string, signal?: AbortSignal): Promise<boolean>;
}

export const defaultStartFolderDeps: StartFolderDeps = {
	repoRoot: (cwd, signal) => git.repo.root(cwd, signal),
	// `remote.url` reports "no such remote" as undefined; this interface uses null for
	// absent throughout, so normalise here rather than accepting both downstream.
	originUrl: async (cwd, signal) => (await git.remote.url(cwd, "origin", signal)) ?? null,
	isIgnored: (cwd, signal) => git.repo.ignored(cwd, signal),
};

/**
 * The decision, with the probing already done.
 *
 * `parseGitHubRepo` owns what counts as a GitHub remote — it handles https, scp-style ssh
 * and `git://`, and rejects look-alike hosts. Re-deriving that here would be a second
 * definition to keep in step.
 */
export function classifyStartFolder(repoRoot: string | null, originUrl: string | null, ignored = false): StartFolder {
	if (!repoRoot) return { kind: "plain" };
	const slug = originUrl ? parseGitHubRepo(originUrl) : null;
	const base: StartFolder = slug ? { kind: "github", slug } : { kind: "git" };
	// The kind stays accurate — the repository is real — and the exclusion rides alongside
	// it, rather than pretending a checkout is not a checkout.
	return ignored ? { ...base, ignored: true } : base;
}

/**
 * Probe `cwd` and classify it, failing in the safe direction at every step.
 *
 * "Safe" means withholding scope, never inventing it. If we cannot tell whether this is a
 * repository, we say it is not — so a broken probe costs a suggestion rather than leaking a
 * secret. If we know it IS a repository but cannot read the remote, we say `git`: claiming
 * `plain` there would be false and would suppress legitimate version-control work, while
 * `git` is true and still withholds GitHub.
 */
export async function resolveStartFolder(
	cwd: string,
	deps: StartFolderDeps = defaultStartFolderDeps,
	signal?: AbortSignal,
): Promise<StartFolder> {
	let root: string | null;
	try {
		root = await deps.repoRoot(cwd, signal);
	} catch {
		return { kind: "plain" };
	}
	if (!root) return { kind: "plain" };

	let origin: string | null = null;
	try {
		origin = await deps.originUrl(cwd, signal);
	} catch {
		// Repository confirmed, remote unknown — see above.
	}

	let ignored = false;
	try {
		ignored = await deps.isIgnored(cwd, signal);
	} catch {
		// `check-ignore` reports "not ignored" as exit 1, not as a failure, so a throw here
		// means git itself is broken — and `repoRoot` already succeeded. Treat it as not
		// ignored rather than cautioning in every repository on a broken probe.
	}
	return classifyStartFolder(root, origin, ignored);
}
