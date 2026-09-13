#!/usr/bin/env bun

import { spawn } from "bun";

export type FileWorkers = 0 | 2;

export function parseFileWorkers(
	args: readonly string[],
	environment: Record<string, string | undefined> = Bun.env,
): FileWorkers {
	const option = args.find(argument => argument.startsWith("--file-workers="));
	const raw = option?.slice("--file-workers=".length) ?? environment.XCSH_TEST_FILE_WORKERS ?? "0";
	if (raw !== "0" && raw !== "2") {
		throw new Error(`XCSH test file workers must be 0 or 2, received ${JSON.stringify(raw)}`);
	}
	return Number(raw) as FileWorkers;
}

export function testCommand(fileWorkers: FileWorkers): string[] {
	return [
		"bun",
		"run",
		"--workspaces",
		"--if-present",
		"test",
		"--",
		...bunTestFlags(fileWorkers),
	];
}

export function verifiedNativeTestCommands(fileWorkers: FileWorkers): string[][] {
	const flags = bunTestFlags(fileWorkers);
	return [
		[
			"bun",
			"run",
			"--workspaces",
			"--filter",
			"!@f5-sales-demo/pi-natives",
			"--if-present",
			"test",
			"--",
			...flags,
		],
		["bun", "test", "--cwd", "packages/natives", ...flags],
	];
}

export function bunTestFlags(fileWorkers: FileWorkers): string[] {
	const flags = ["--only-failures", "--max-concurrency=2"];
	if (fileWorkers === 2) flags.push("--parallel=2");
	return flags;
}

async function run(command: readonly string[]): Promise<number> {
	const process = spawn([...command], {
		cwd: Bun.env.XCSH_SOURCE_ROOT ?? new URL("..", import.meta.url).pathname,
		env: Bun.env,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	return await process.exited;
}

if (import.meta.main) {
	let fileWorkers: FileWorkers;
	try {
		fileWorkers = parseFileWorkers(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(2);
	}

	const dependencyExitCode = await run(["bun", "run", "ensure:dependencies"]);
	if (dependencyExitCode !== 0) process.exit(dependencyExitCode);

	const nativeManifestTool = Bun.env.XCSH_NATIVE_MANIFEST_TOOL;
	if (!nativeManifestTool) {
		const nativeExitCode = await run(["bun", "scripts/ensure-dev-native.ts"]);
		if (nativeExitCode !== 0) process.exit(nativeExitCode);
		process.exit(await run(testCommand(fileWorkers)));
	}
	const nativeManifest = Bun.env.XCSH_VERIFIED_NATIVE_MANIFEST;
	const sourceSha = Bun.env.GITHUB_SHA;
	if (!nativeManifest || !sourceSha) {
		console.error("XCSH_VERIFIED_NATIVE_MANIFEST and GITHUB_SHA are required for verified native reuse");
		process.exit(2);
	}
	const verifyExitCode = await run([
		"bun",
		nativeManifestTool,
		"verify",
		"--source-sha",
		sourceSha,
		"--manifest",
		nativeManifest,
		"--root",
		Bun.env.XCSH_SOURCE_ROOT ?? process.cwd(),
	]);
	if (verifyExitCode !== 0) process.exit(verifyExitCode);
	for (const command of verifiedNativeTestCommands(fileWorkers)) {
		const exitCode = await run(command);
		if (exitCode !== 0) process.exit(exitCode);
	}
}
