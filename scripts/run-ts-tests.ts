#!/usr/bin/env bun

import { spawn } from "bun";

/** Number of Bun file workers. Zero preserves the serial production path. */
export type FileWorkers = number;
export type TestShard = "native-independent" | "native-dependent";

interface TestShardManifest {
	schema_version: number;
	shards: Record<TestShard, string[]>;
}

export const MAX_FILE_WORKERS = 40;

export function parseFileWorkers(
	args: readonly string[],
	environment: Record<string, string | undefined> = Bun.env,
): FileWorkers {
	if (args.some(argument => argument === "--concurrent" || argument.startsWith("--concurrent="))) {
		throw new Error("--concurrent is not supported; use --file-workers=<0..40> for file-level parallelism");
	}
	const option = args.find(argument => argument.startsWith("--file-workers="));
	const raw = option?.slice("--file-workers=".length) ?? environment.XCSH_TEST_FILE_WORKERS ?? "0";
	if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) {
		throw new Error(`XCSH test file workers must be an integer from 0 through ${MAX_FILE_WORKERS}, received ${JSON.stringify(raw)}`);
	}
	const workers = Number(raw);
	if (workers > MAX_FILE_WORKERS) {
		throw new Error(`XCSH test file workers must be an integer from 0 through ${MAX_FILE_WORKERS}, received ${JSON.stringify(raw)}`);
	}
	return workers;
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

export function parseShard(args: readonly string[]): TestShard | undefined {
	const options = args.filter(argument => argument.startsWith("--shard="));
	if (options.length > 1) throw new Error("TypeScript test shard may be specified only once");
	if (options.length === 0) return undefined;
	const shard = options[0]?.slice("--shard=".length);
	if (shard !== "native-independent" && shard !== "native-dependent") {
		throw new Error(`unknown TypeScript test shard ${JSON.stringify(shard)}`);
	}
	return shard;
}

export function shardTestCommands(packages: readonly string[], fileWorkers: FileWorkers): string[][] {
	const flags = bunTestFlags(fileWorkers);
	return packages.map(packageName => ["bun", "run", "--filter", packageName, "test", "--", ...flags]);
}

export async function loadShardPackages(shard: TestShard, sourceRoot: string): Promise<string[]> {
	const manifest = (await Bun.file(`${sourceRoot}/.github/ts-test-shards.json`).json()) as TestShardManifest;
	if (manifest.schema_version !== 1 || !Array.isArray(manifest.shards?.[shard])) {
		throw new Error(`invalid TypeScript test shard manifest for ${shard}`);
	}
	return manifest.shards[shard];
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
	if (fileWorkers > 0) flags.push(`--parallel=${fileWorkers}`);
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
	let shard: TestShard | undefined;
	try {
		fileWorkers = parseFileWorkers(process.argv.slice(2));
		shard = parseShard(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(2);
	}

	const dependencyExitCode = await run(["bun", "run", "ensure:dependencies"]);
	if (dependencyExitCode !== 0) process.exit(dependencyExitCode);

	const sourceRoot = Bun.env.XCSH_SOURCE_ROOT ?? new URL("..", import.meta.url).pathname;
	if (shard === "native-independent") {
		for (const command of shardTestCommands(await loadShardPackages(shard, sourceRoot), fileWorkers)) {
			const exitCode = await run(command);
			if (exitCode !== 0) process.exit(exitCode);
		}
		process.exit(0);
	}

	const nativeManifestTool = Bun.env.XCSH_NATIVE_MANIFEST_TOOL;
	if (!nativeManifestTool) {
		if (shard) {
			console.error("native-dependent TypeScript shard requires XCSH_NATIVE_MANIFEST_TOOL");
			process.exit(2);
		}
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
	if (shard === "native-dependent") {
		for (const command of shardTestCommands(await loadShardPackages(shard, sourceRoot), fileWorkers)) {
			const exitCode = await run(command);
			if (exitCode !== 0) process.exit(exitCode);
		}
		process.exit(0);
	}
	for (const command of verifiedNativeTestCommands(fileWorkers)) {
		const exitCode = await run(command);
		if (exitCode !== 0) process.exit(exitCode);
	}
}
