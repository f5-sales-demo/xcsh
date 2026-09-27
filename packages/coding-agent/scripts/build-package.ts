#!/usr/bin/env bun

import path from "node:path";

export interface PackageBuildOperations {
	prepare: () => Promise<void>;
	compile: () => Promise<void>;
	reset: () => Promise<void>;
}

export async function runPackageBuild(operations: PackageBuildOperations): Promise<void> {
	try {
		await operations.prepare();
		await operations.compile();
	} finally {
		await operations.reset();
	}
}

const packageRoot = path.resolve(import.meta.dir, "..");

async function run(command: string[]): Promise<void> {
	const child = Bun.spawn(command, {
		cwd: packageRoot,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) throw new Error(`command failed (${exitCode}): ${command.join(" ")}`);
}

async function prepare(): Promise<void> {
	await run(["bun", "run", "generate-build-info"]);
	await run(["bun", "run", "generate-extension-capabilities"]);
	await run(["bun", "run", "generate-api-catalog-qmd-index"]);
	await run(["bun", "run", "generate-documentation-index"]);
	if (!(await Bun.file(path.join(packageRoot, "src/internal-urls/api-spec-index.generated.ts")).exists())) {
		throw new Error("generated API specification index is missing");
	}
	await run(["bun", "--cwd=../stats", "scripts/generate-client-bundle.ts", "--generate"]);
	await run(["bun", "--cwd=../office-pane", "scripts/generate-client-bundle.ts", "--generate"]);
	await run(["bun", "--cwd=../natives", "run", "embed:native"]);
}

async function compile(): Promise<void> {
	await run(["bun", "scripts/build-binary.ts"]);
}

async function reset(): Promise<void> {
	const commands = [
		["bun", "--cwd=../natives", "run", "embed:native", "--reset"],
		["bun", "--cwd=../stats", "scripts/generate-client-bundle.ts", "--reset"],
		["bun", "--cwd=../office-pane", "scripts/generate-client-bundle.ts", "--reset"],
		["bun", "run", "generate-documentation-index", "--reset"],
	];
	const failures: unknown[] = [];
	for (const command of commands) {
		try {
			await run(command);
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length > 0) throw new AggregateError(failures, "failed to restore generated build placeholders");
}

if (import.meta.main) await runPackageBuild({ prepare, compile, reset });
