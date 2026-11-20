#!/usr/bin/env bun

import path from "node:path";

export interface PackageBuildOperations {
	prepare: () => Promise<void>;
	compile: () => Promise<void>;
	reset: () => Promise<void>;
}

export async function runPackageBuild(operations: PackageBuildOperations): Promise<void> {
	let failed = false;
	let failure: unknown;
	try {
		await operations.prepare();
		await operations.compile();
	} catch (error) {
		failed = true;
		failure = error;
	}
	try {
		await operations.reset();
	} catch (error) {
		if (failed) throw new AggregateError([failure, error], "Package build and cleanup failed", { cause: failure });
		throw error;
	}
	if (failed) throw failure;
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
	await run([process.execPath, "run", "generate-build-info"]);
	await run([process.execPath, "run", "generate-extension-capabilities"]);
	await run([process.execPath, "scripts/prepare-verified-corpora.ts"]);
	if (!(await Bun.file(path.join(packageRoot, "src/internal-urls/api-spec-index.generated.ts")).exists())) {
		throw new Error("generated API specification index is missing");
	}
	await run([process.execPath, "--cwd=../stats", "scripts/generate-client-bundle.ts", "--generate"]);
	await run([process.execPath, "--cwd=../office-pane", "scripts/generate-client-bundle.ts", "--generate"]);
	await run([process.execPath, "--cwd=../natives", "run", "embed:native"]);
}

async function compile(): Promise<void> {
	await run([process.execPath, "scripts/build-binary.ts"]);
}

async function reset(): Promise<void> {
	const commands = [
		[process.execPath, "--cwd=../natives", "run", "embed:native", "--reset"],
		[process.execPath, "--cwd=../stats", "scripts/generate-client-bundle.ts", "--reset"],
		[process.execPath, "--cwd=../office-pane", "scripts/generate-client-bundle.ts", "--reset"],
		[process.execPath, "run", "generate-documentation-index", "--reset"],
		[process.execPath, "run", "generate-terraform-documentation-index", "--reset"],
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
