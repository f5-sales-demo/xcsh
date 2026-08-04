#!/usr/bin/env bun

import { $ } from "bun";
import * as path from "node:path";

type LockWorkspace = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};

type LockPackage = readonly [locator: string, ...metadata: unknown[]];

export type BunLockFile = {
	workspaces: Record<string, LockWorkspace>;
	packages: Record<string, LockPackage>;
};

export type DependencyInstallMismatch = {
	workspace: string;
	name: string;
	requested: string;
	lockedVersions: string[];
	installedVersion: string | undefined;
};

const repoRoot = path.join(import.meta.dir, "..");

if (import.meta.main) {
	const repair = process.argv.includes("--repair");
	let lock = await readLockFile(repoRoot);
	let mismatches = await inspectDependencyInstall(repoRoot, lock);

	if (repair && mismatches.length > 0) {
		process.stderr.write(`${formatDependencyInstallMismatches(mismatches)}\nRepairing dependency installation...\n`);
		// A stale physical link needs a frozen reconstruction. A workspace request with
		// no satisfying package entry means the lock itself is stale (release version
		// bumps can create this state before platform packages are published), so a
		// frozen install cannot repair it and the lock must be refreshed first.
		if (dependencyInstallNeedsLockRefresh(mismatches)) {
			for (const target of lockRefreshTargets(mismatches)) {
				const workspaceRoot = path.join(repoRoot, target.workspace);
				const manifestPath = path.join(workspaceRoot, "package.json");
				const manifest = await Bun.file(manifestPath).text();
				let exitCode = 1;
				try {
					// Bun adds positional dependencies to the root when invoked there, even
					// with --filter. Run from the owner and restore its manifest because
					// update also rewrites unrelated ranges and JSON formatting.
					const result = await $`bun update ${target.names} --force`.cwd(workspaceRoot).nothrow();
					exitCode = result.exitCode;
				} finally {
					await Bun.write(manifestPath, manifest);
				}
				if (exitCode !== 0) process.exit(exitCode);
			}
		} else {
			const result = await $`bun install --frozen-lockfile --force`.cwd(repoRoot).nothrow();
			if (result.exitCode !== 0) process.exit(result.exitCode);
		}
		lock = await readLockFile(repoRoot);
		mismatches = await inspectDependencyInstall(repoRoot, lock);
	}

	if (mismatches.length > 0) {
		process.stderr.write(`${formatDependencyInstallMismatches(mismatches)}\nRun: bun run ensure:dependencies\n`);
		process.exit(1);
	}
}

async function readLockFile(root: string): Promise<BunLockFile> {
	const text = await Bun.file(path.join(root, "bun.lock")).text();
	return Bun.JSON5.parse(text) as BunLockFile;
}

/**
 * Verify every direct registry dependency against both bun.lock and the package-local installation.
 *
 * Bun's isolated linker puts direct dependencies under each workspace's node_modules. Those symlinks can
 * survive a pull that updates manifests and bun.lock, causing TypeScript and runtime resolution to keep
 * using an obsolete SDK even though `bun pm ls` reports the new locked version. Reading the installed
 * package.json through each workspace link detects that state directly.
 */
export async function inspectDependencyInstall(
	root: string,
	lock: BunLockFile,
): Promise<DependencyInstallMismatch[]> {
	const lockedVersions = indexLockedVersions(lock.packages);
	const mismatches: DependencyInstallMismatch[] = [];

	for (const [workspace, config] of Object.entries(lock.workspaces).sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		const dependencies = [
			...Object.entries({ ...config.dependencies, ...config.devDependencies }).map(
				([name, requested]) => [name, requested, true] as const,
			),
			...Object.entries(config.optionalDependencies ?? {}).map(
				([name, requested]) => [name, requested, false] as const,
			),
		].sort(([left], [right]) => left.localeCompare(right));
		for (const [name, requested, required] of dependencies) {
			if (requested.startsWith("workspace:")) continue;

			const candidates = (lockedVersions.get(name) ?? []).filter(version =>
				Bun.semver.satisfies(version, requested),
			);
			const installedVersion = await readInstalledVersion(root, workspace, name);
			if (!required && installedVersion === undefined && candidates.length > 0) continue;
			if (installedVersion === undefined || !candidates.includes(installedVersion)) {
				mismatches.push({
					workspace,
					name,
					requested,
					lockedVersions: candidates,
					installedVersion,
				});
			}
		}
	}

	return mismatches;
}

export function formatDependencyInstallMismatches(mismatches: DependencyInstallMismatch[]): string {
	const lines = ["Installed dependencies do not match bun.lock:"];
	for (const mismatch of mismatches) {
		const workspace = mismatch.workspace === "" ? "." : mismatch.workspace;
		const installed = mismatch.installedVersion ?? "missing";
		const locked = mismatch.lockedVersions.length > 0 ? mismatch.lockedVersions.join(" or ") : "no matching lock entry";
		lines.push(`- ${workspace}: ${mismatch.name} installed=${installed}, locked=${locked}`);
	}
	return lines.join("\n");
}

export function dependencyInstallNeedsLockRefresh(mismatches: readonly DependencyInstallMismatch[]): boolean {
	return mismatches.some(mismatch => mismatch.lockedVersions.length === 0);
}

function lockRefreshTargets(
	mismatches: readonly DependencyInstallMismatch[],
): Array<{ workspace: string; names: string[] }> {
	const targets = new Map<string, Set<string>>();
	for (const mismatch of mismatches) {
		if (mismatch.lockedVersions.length > 0) continue;
		const names = targets.get(mismatch.workspace) ?? new Set<string>();
		names.add(mismatch.name);
		targets.set(mismatch.workspace, names);
	}
	return [...targets.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([workspace, names]) => ({ workspace, names: [...names].sort() }));
}

function indexLockedVersions(packages: BunLockFile["packages"]): Map<string, string[]> {
	const versions = new Map<string, string[]>();
	for (const entry of Object.values(packages)) {
		const parsed = parseRegistryLocator(entry[0]);
		if (!parsed) continue;
		const packageVersions = versions.get(parsed.name) ?? [];
		packageVersions.push(parsed.version);
		versions.set(parsed.name, packageVersions);
	}
	return versions;
}

function parseRegistryLocator(locator: string): { name: string; version: string } | undefined {
	const separator = locator.lastIndexOf("@");
	if (separator <= 0) return undefined;
	const name = locator.slice(0, separator);
	const version = locator.slice(separator + 1);
	if (!Bun.semver.satisfies(version, version)) return undefined;
	return { name, version };
}

async function readInstalledVersion(root: string, workspace: string, name: string): Promise<string | undefined> {
	const packageJsonPath = path.join(root, workspace, "node_modules", ...name.split("/"), "package.json");
	try {
		const manifest = (await Bun.file(packageJsonPath).json()) as { version?: unknown };
		return typeof manifest.version === "string" ? manifest.version : undefined;
	} catch (error) {
		if (isEnoent(error)) return undefined;
		throw error;
	}
}

/** This script runs before workspace links are guaranteed to exist, so it must
 * remain dependency-free and cannot import the shared utility package. */
function isEnoent(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
