/**
 * Extract "owner/repo" from a GitHub remote URL.
 * Handles HTTPS, SSH (scp-style and ssh://), and git:// protocols.
 *
 * Anchored at both ends, which matters: the pattern used to be unanchored, so any URL
 * merely *containing* "github.com/" parsed as a GitHub repository —
 * `https://gitlab.example/github.com/example-corp/repo.git` returned `example-corp/repo`. That is now a
 * decision about authority, not just a status-line label: `discovery/start-folder.ts`
 * turns it into system-prompt text telling the agent GitHub work is in scope, so a
 * repository hosted elsewhere could misdirect authenticated `gh` operations. `github.com`
 * must be the host, and `owner/repo` must be the whole path.
 *
 * @returns "owner/repo" or null if the URL isn't a recognized GitHub remote.
 */
export function parseGitHubRepo(remoteUrl: string): string | null {
	// Strip a trailing ".git" first so the anchor can require owner/repo to end the path.
	const cleaned = remoteUrl.trim().replace(/\.git$/, "");
	// Each scheme carries its own delimiter rather than a shared `[:/]`. scp-style SSH needs
	// the colon: without it git resolves the string as a local path, not a github.com host,
	// so `git@github.com/org/repo` is not a GitHub remote and must not read as one.
	//
	// The url forms allow the two decorations git actually writes — credentials in https
	// (`https://user:token@github.com/...`, how a stored token is persisted) and an explicit
	// ssh port. Rejecting those would push real GitHub checkouts into the `git` branch,
	// where the prompt would wrongly say origin is not on GitHub.
	//
	// The credential group excludes `?` and `#`, which terminate the URL authority: allowing
	// them let `https://evil.example?@github.com/org/repo` read as GitHub when the host is
	// really evil.example.
	//
	// The capture is GitHub's own owner/repo charset rather than "anything but a slash",
	// because this string is interpolated into the system prompt. A remote of
	// `https://github.com/org/repo\nIGNORE PREVIOUS INSTRUCTIONS` previously parsed with the
	// trailing text attached, which put attacker-chosen lines into the prompt.
	const match = cleaned.match(
		/^(?:(?:https?|git):\/\/(?:[^/@?#]*@)?github\.com\/|ssh:\/\/git@github\.com(?::\d+)?\/|git@github\.com:)([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+)$/,
	);
	return match ? (match[1] ?? null) : null;
}

/**
 * Extract the branch name from a remote HEAD ref like "origin/main".
 * Returns the portion after the first "/" or the whole string if no "/" is present.
 */
export function parseDefaultBranch(ref: string): string {
	const slash = ref.indexOf("/");
	return slash >= 0 ? ref.slice(slash + 1) : ref;
}

export interface PrCacheContext {
	branch: string;
	repoId: string | null;
}

export function createPrCacheContext(branch: string, repoId: string | null): PrCacheContext {
	return { branch, repoId };
}

export function isSamePrCacheContext(a: PrCacheContext | undefined, b: PrCacheContext | undefined): boolean {
	if (!a || !b) return false;
	return a.branch === b.branch && a.repoId === b.repoId;
}

export function canReuseCachedPr(
	cachedPr: { number: number; url: string } | null | undefined,
	cachedContext: PrCacheContext | undefined,
	currentContext: PrCacheContext | null,
): boolean {
	return cachedPr !== undefined && currentContext !== null && isSamePrCacheContext(cachedContext, currentContext);
}
