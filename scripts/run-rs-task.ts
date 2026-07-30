#!/usr/bin/env bun

import { $ } from "bun";
import * as path from "node:path";

const RUST_AFFECTING_FILE_NAMES = [
	"Cargo.toml",
	"Cargo.lock",
	"build.rs",
	"rust-toolchain",
	"rust-toolchain.toml",
	"clippy.toml",
	".clippy.toml",
	"rustfmt.toml",
	".rustfmt.toml",
] as const satisfies readonly string[];
const TASK_COMMANDS = {
	"check:rs": [
		["cargo", "fmt", "--all", "--", "--check"],
		["cargo", "clippy", "--workspace", "--", "-D", "warnings"],
	],
	"fix:rs": [
		["cargo", "fmt", "--all"],
		[
			"cargo",
			"clippy",
			"--workspace",
			"--fix",
			"--allow-dirty",
			"--all-targets",
			"--no-deps",
			"--allow-staged",
			"--broken-code",
			"--allow-no-vcs",
		],
	],
	"fmt:rs": [["cargo", "fmt", "--all"]],
	"lint:rs": [["cargo", "clippy", "--workspace", "--", "-D", "warnings"]],
	"test:rs": [["cargo", "nextest", "run", "--workspace", "--status-level=fail", "--final-status-level=fail"]],
} as const satisfies Record<string, readonly (readonly string[])[]>;

type RustTaskName = keyof typeof TASK_COMMANDS;

const repoRoot = path.join(import.meta.dir, "..");

// Guarded so the decision helpers can be imported and tested. Without this, importing the module ran the
// whole task and called process.exit, which is why the skip logic had no test to catch #2573.
if (import.meta.main) {
	const taskName = process.argv[2];

	if (!isRustTaskName(taskName)) {
		console.error(`Unknown Rust task: ${taskName ?? "(missing)"}`);
		process.exit(1);
	}

	if (!(isCI() || (await hasRustAffectingChanges(taskName)))) {
		console.log(`Skipping ${taskName} (not in CI and no Rust-affecting changes were found).`);
		process.exit(0);
	}

	for (const command of TASK_COMMANDS[taskName]) {
		const exitCode = await runCommand(command);
		if (exitCode !== 0) {
			process.exit(exitCode);
		}
	}
}

function isRustTaskName(value: string | undefined): value is RustTaskName {
	return value != null && value in TASK_COMMANDS;
}

function isCI(): boolean {
	const value = Bun.env.CI;
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized !== "" && normalized !== "0" && normalized !== "false";
}

/**
 * Whether this branch touches Rust — uncommitted edits OR anything already committed on it.
 *
 * Committing used to switch the check off. `git status --porcelain` reports the working tree only, so the
 * moment Rust changes were committed the tree went clean, this returned false, and `check:rs` skipped
 * itself — precisely when someone is about to push. A real `cargo fmt` violation reached CI that way
 * (#2573), and the skip message reads like a considered decision rather than a gap.
 *
 * So the question is asked of the branch, not of the tree: uncommitted changes plus the diff against the
 * default branch. Anything that cannot be determined runs the task, matching the existing posture that a
 * broken git query must not silently disable a gate.
 */
async function hasRustAffectingChanges(taskName: RustTaskName): Promise<boolean> {
	const uncommitted = await $`git status --porcelain -z`.cwd(repoRoot).quiet().nothrow();
	if (uncommitted.exitCode !== 0) {
		const stderr = uncommitted.stderr.toString().trim();
		const suffix = stderr === "" ? `exit ${uncommitted.exitCode}` : stderr;
		console.warn(`Warning: failed to inspect git status: ${suffix}. Running ${taskName} conservatively.`);
		return true;
	}
	if (getChangedPathsFromPorcelain(uncommitted.stdout).some(isRustAffectingPath)) return true;

	const base = await defaultBranchRef();
	if (base === undefined) {
		console.warn(`Warning: could not resolve the default branch. Running ${taskName} conservatively.`);
		return true;
	}
	// Three dots: compare against the merge base, so commits that merged into the default branch after
	// this one started are not mistaken for changes this branch made.
	const committed = await $`git diff --name-only -z ${`${base}...HEAD`}`.cwd(repoRoot).quiet().nothrow();
	if (committed.exitCode !== 0) {
		const stderr = committed.stderr.toString().trim();
		const suffix = stderr === "" ? `exit ${committed.exitCode}` : stderr;
		console.warn(`Warning: failed to diff against ${base}: ${suffix}. Running ${taskName} conservatively.`);
		return true;
	}
	return new TextDecoder().decode(committed.stdout).split("\0").filter(Boolean).some(isRustAffectingPath);
}

/** The default branch's remote ref, preferring what the remote itself reports. */
async function defaultBranchRef(): Promise<string | undefined> {
	const symbolic = await $`git symbolic-ref --quiet refs/remotes/origin/HEAD`.cwd(repoRoot).quiet().nothrow();
	if (symbolic.exitCode === 0) {
		const ref = symbolic.stdout.toString().trim();
		if (ref !== "") return ref;
	}
	// A fresh clone may not have origin/HEAD set. Fall back to the conventional names, remote first,
	// and only to a local branch when there is no remote copy to compare against.
	for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
		const exists = await $`git rev-parse --verify --quiet ${`${candidate}^{commit}`}`.cwd(repoRoot).quiet().nothrow();
		if (exists.exitCode === 0) return candidate;
	}
	return undefined;
}

export function getChangedPathsFromPorcelain(buf: Uint8Array): string[] {
	const entries = new TextDecoder().decode(buf).split("\0").filter(Boolean);
	const changedPaths: string[] = [];

	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry.length < 4) continue;

		const status = entry.slice(0, 2);
		const changedPath = entry.slice(3);
		if (changedPath !== "") {
			changedPaths.push(changedPath);
		}

		if (status.includes("R") || status.includes("C")) {
			const renamedPath = entries[index + 1];
			if (renamedPath) {
				changedPaths.push(renamedPath);
				index += 1;
			}
		}
	}

	return changedPaths;
}

export function isRustAffectingPath(changedPath: string): boolean {
	const normalized = changedPath.replace(/\\/g, "/");
	const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
	return (
		normalized.endsWith(".rs") ||
		normalized.startsWith(".cargo/") ||
		isOneOf(fileName, RUST_AFFECTING_FILE_NAMES)
	);
}

function isOneOf<T extends string>(value: string, values: readonly T[]): value is T {
	return values.some(entry => entry === value);
}

async function runCommand(command: readonly string[]): Promise<number> {
	const proc = Bun.spawn([...command], {
		cwd: repoRoot,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	return proc.exited;
}
