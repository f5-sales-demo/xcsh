export interface EnvLike {
	readonly XCSH_BUILD_COMMIT?: string;
	readonly XCSH_BUILD_BRANCH?: string;
	readonly XCSH_BUILD_TAG?: string;
	readonly XCSH_BUILD_PR?: string;
}

export type GitFn = (args: string[]) => Promise<string>;
export type GhFn = (sha: string) => Promise<string>;

function pick(value: string | undefined): string {
	return value?.trim() ?? "";
}

export async function resolveCommit(env: EnvLike, git: GitFn): Promise<string> {
	return pick(env.XCSH_BUILD_COMMIT) || (await git(["rev-parse", "HEAD"]));
}

export async function resolveBranch(env: EnvLike, git: GitFn): Promise<string> {
	const override = pick(env.XCSH_BUILD_BRANCH);
	if (override) return override;

	const local = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
	if (local && local !== "HEAD") return local;

	const remote = await git(["branch", "-r", "--contains", "HEAD"]);
	for (const raw of remote.split("\n")) {
		const line = raw.trim();
		if (!line || line.includes("->") || line === "HEAD") continue;
		const stripped = line.replace(/^origin\//, "");
		if (stripped && stripped !== "HEAD") return stripped;
	}

	return "unknown";
}

export async function resolveTag(env: EnvLike, git: GitFn): Promise<string> {
	return pick(env.XCSH_BUILD_TAG) || (await git(["describe", "--exact-match", "--tags", "HEAD"]));
}

export async function resolveDirty(_env: EnvLike, git: GitFn): Promise<boolean> {
	const status = await git(["status", "--porcelain"]);
	return status.length > 0;
}

export async function resolvePrNumber(sha: string, env: EnvLike, gh: GhFn): Promise<string> {
	const override = pick(env.XCSH_BUILD_PR);
	if (override) return override;
	if (!sha) return "";
	return await gh(sha);
}
