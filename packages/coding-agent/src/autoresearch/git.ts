import type { ExtensionAPI } from "../extensibility/extensions";
import * as git from "../utils/git";
import { isAutoresearchLocalStatePath, normalizeAutoresearchPath } from "./helpers";

const AUTORESEARCH_BRANCH_PREFIX = "autoresearch/";
const BRANCH_NAME_MAX_LENGTH = 48;
type EnsureAutoresearchBranchResult = { error: string; ok: false } | { branchName: string; created: boolean; ok: true };
export const getCurrentAutoresearchBranch = async (_api: ExtensionAPI, workDir: string): Promise<string | null> =>
	(b => (b.startsWith(AUTORESEARCH_BRANCH_PREFIX) ? b : null))((await git.branch.current(workDir)) ?? "");
const fail = (error: string): EnsureAutoresearchBranchResult => ({ error, ok: false });
export async function ensureAutoresearchBranch(
	api: ExtensionAPI,
	workDir: string,
	goal: string | null,
): Promise<EnsureAutoresearchBranchResult> {
	const repoRoot = await git.repo.root(workDir);
	if (!repoRoot) {
		return fail(
			"Autoresearch requires a git repository so it can isolate experiments and revert failed runs safely.",
		);
	}
	let dirtyPathsOutput: string;
	try {
		dirtyPathsOutput = await git.status(repoRoot, { porcelainV1: true, untrackedFiles: "all", z: true });
	} catch (err) {
		return fail(
			`Unable to inspect git status before starting autoresearch: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	const workDirPrefix = await git.show.prefix(workDir).catch(() => "");
	const unsafeDirtyPaths = collectUnsafeDirtyPaths(dirtyPathsOutput, workDirPrefix);
	const currentBranch = await getCurrentAutoresearchBranch(api, workDir);
	if (currentBranch) {
		if (unsafeDirtyPaths.length > 0) return buildUnsafeDirtyPathsFailure(unsafeDirtyPaths);
		return { branchName: currentBranch, created: false, ok: true };
	}
	if (unsafeDirtyPaths.length > 0) return buildUnsafeDirtyPathsFailure(unsafeDirtyPaths);
	const branchName = await allocateBranchName(workDir, goal);
	try {
		await git.branch.checkoutNew(workDir, branchName);
	} catch (err) {
		return fail(
			`Failed to create autoresearch branch ${branchName}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	return { branchName, created: true, ok: true };
}
export const parseWorkDirDirtyPaths = (statusOutput: string, workDirPrefix: string): string[] =>
	parseWorkDirDirtyPathsWithStatus(statusOutput, workDirPrefix).map(e => e.path);
function relativizeGitPathToWorkDir(repoRelativePath: string, workDirPrefix: string): string | null {
	const normalizedPath = normalizeStatusPath(repoRelativePath);
	const normalizedPrefix = normalizeAutoresearchPath(workDirPrefix);
	if (normalizedPrefix === "" || normalizedPrefix === ".") return normalizedPath;
	if (normalizedPath === normalizedPrefix) return ".";
	if (!normalizedPath.startsWith(`${normalizedPrefix}/`)) return null;
	return normalizeAutoresearchPath(normalizedPath.slice(normalizedPrefix.length + 1));
}
function normalizeStatusPath(path: string): string {
	let normalized = path.trim();
	if (normalized.startsWith('"') && normalized.endsWith('"')) normalized = normalized.slice(1, -1);
	return normalizeAutoresearchPath(normalized);
}
async function allocateBranchName(workDir: string, goal: string | null): Promise<string> {
	const baseName = `${AUTORESEARCH_BRANCH_PREFIX}${slugifyGoal(goal)}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
	let candidate = baseName;
	let suffix = 2;
	while (await git.ref.exists(workDir, `refs/heads/${candidate}`)) {
		candidate = `${baseName}-${suffix}`;
		suffix += 1;
	}
	return candidate;
}
function slugifyGoal(goal: string | null): string {
	const slug = (goal ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.slice(0, BRANCH_NAME_MAX_LENGTH).replace(/-+$/g, "") || "session";
}
function buildUnsafeDirtyPathsFailure(unsafeDirtyPaths: string[]): EnsureAutoresearchBranchResult {
	return fail(
		`Autoresearch needs a clean git worktree before it can create or reuse an isolated branch. Commit or stash these paths first: ${unsafeDirtyPaths.slice(0, 5).join(", ")}${unsafeDirtyPaths.length > 5 ? ` (+${unsafeDirtyPaths.length - 5} more)` : ""}`,
	);
}
function collectUnsafeDirtyPaths(statusOutput: string, workDirPrefix: string): string[] {
	return parseDirtyPathsWithStatus(statusOutput)
		.map(entry => ({ rel: relativizeGitPathToWorkDir(entry.path, workDirPrefix), raw: entry.path }))
		.filter(({ rel }) => !(rel && isAutoresearchLocalStatePath(rel)))
		.map(({ rel, raw }) => rel ?? normalizeStatusPath(raw));
}
type DirtyPathEntry = { path: string; untracked: boolean };
function parseDirtyPathsWithStatus(statusOutput: string): DirtyPathEntry[] {
	const seen = new Set<string>();
	const results: DirtyPathEntry[] = [];
	if (statusOutput.includes("\0")) {
		let index = 0;
		while (index + 3 <= statusOutput.length) {
			const statusToken = statusOutput.slice(index, index + 3);
			index += 3;
			const pathEnd = statusOutput.indexOf("\0", index);
			if (pathEnd < 0) break;
			const firstPath = statusOutput.slice(index, pathEnd);
			index = pathEnd + 1;
			const statusCode = statusToken.trim();
			addDirtyPathEntry(seen, results, firstPath, statusCode.startsWith("??"));
			if (statusCode.startsWith("R") || statusCode.startsWith("C")) {
				const secondPathEnd = statusOutput.indexOf("\0", index);
				if (secondPathEnd < 0) break;
				const secondPath = statusOutput.slice(index, secondPathEnd);
				index = secondPathEnd + 1;
				addDirtyPathEntry(seen, results, secondPath, false);
			}
		}
	} else {
		for (const line of statusOutput.split("\n")) {
			const trimmedLine = line.trimEnd();
			if (trimmedLine.length < 4) continue;
			const statusToken = trimmedLine.slice(0, 3);
			const rawPath = trimmedLine.slice(3).trim();
			if (rawPath.length === 0) continue;
			const untracked = statusToken.trim().startsWith("??");
			const renameParts = rawPath.split(" -> ");
			for (const renamePart of renameParts) addDirtyPathEntry(seen, results, renamePart, untracked);
		}
	}
	return results;
}
function addDirtyPathEntry(seen: Set<string>, results: DirtyPathEntry[], rawPath: string, untracked: boolean): void {
	const normalizedPath = normalizeStatusPath(rawPath);
	if (normalizedPath.length === 0 || seen.has(normalizedPath)) return;
	seen.add(normalizedPath);
	results.push({ path: normalizedPath, untracked });
}
export function parseWorkDirDirtyPathsWithStatus(statusOutput: string, workDirPrefix: string): DirtyPathEntry[] {
	return parseDirtyPathsWithStatus(statusOutput).flatMap(entry => {
		const rel = relativizeGitPathToWorkDir(entry.path, workDirPrefix);
		return rel !== null ? [{ path: rel, untracked: entry.untracked }] : [];
	});
}
export function computeRunModifiedPaths(
	preRunDirtyPaths: string[],
	currentStatusOutput: string,
	workDirPrefix: string,
): { tracked: string[]; untracked: string[] } {
	const preRunSet = new Set(preRunDirtyPaths);
	const entries = parseWorkDirDirtyPathsWithStatus(currentStatusOutput, workDirPrefix).filter(
		e => !preRunSet.has(e.path) && !isAutoresearchLocalStatePath(e.path),
	);
	return {
		tracked: entries.filter(e => !e.untracked).map(e => e.path),
		untracked: entries.filter(e => e.untracked).map(e => e.path),
	};
}
