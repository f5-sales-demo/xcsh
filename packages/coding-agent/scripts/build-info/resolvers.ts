export interface EnvLike {
	readonly SOURCE_DATE_EPOCH?: string;
	readonly XCSH_BUILD_COMMIT?: string;
	readonly XCSH_BUILD_BRANCH?: string;
	readonly XCSH_BUILD_TAG?: string;
	readonly XCSH_BUILD_PR?: string;
}

export type GitFn = (args: string[]) => Promise<string>;
export type GhFn = (sha: string) => Promise<string>;
export type ClockFn = () => Date;

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

export function resolveBuildDate(env: EnvLike, now: ClockFn = () => new Date()): string {
	const sourceDateEpoch = pick(env.SOURCE_DATE_EPOCH);
	if (!sourceDateEpoch) return now().toISOString();
	if (!/^\d+$/.test(sourceDateEpoch)) {
		throw new Error("SOURCE_DATE_EPOCH must be a non-negative integer");
	}
	const epochMilliseconds = Number(sourceDateEpoch) * 1000;
	if (!Number.isSafeInteger(epochMilliseconds)) {
		throw new Error("SOURCE_DATE_EPOCH must be a safe integer");
	}
	const date = new Date(epochMilliseconds);
	if (Number.isNaN(date.getTime())) {
		throw new Error("SOURCE_DATE_EPOCH must resolve to a valid date");
	}
	return date.toISOString();
}
