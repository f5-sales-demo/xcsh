#!/usr/bin/env bun

import * as path from "node:path";
import { spawn } from "bun";
import { type NativeManifest, verifyNativeManifest } from "../../../scripts/ci-native-manifest";

const packageRoot = path.join(import.meta.dir, "..");
const repositoryRoot = path.join(packageRoot, "../..");
const manifestPath = Bun.env.XCSH_VERIFIED_NATIVE_MANIFEST;

async function run(args: string[]): Promise<void> {
	const child = spawn(args, {
		cwd: packageRoot,
		env: Bun.env,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await child.exited;
	if (code !== 0) process.exit(code);
}

if (manifestPath) {
	const sourceSha = Bun.env.GITHUB_SHA;
	if (!sourceSha) throw new Error("GITHUB_SHA is required when reusing verified native artifacts");
	const manifest = (await Bun.file(manifestPath).json()) as NativeManifest;
	await verifyNativeManifest(repositoryRoot, manifest, sourceSha);
} else {
	await run(["bun", "run", "build"]);
}

await run(["bun", "test", ...process.argv.slice(2)]);
