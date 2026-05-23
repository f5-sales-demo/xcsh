#!/usr/bin/env bun

import * as path from "node:path";
import { $ } from "bun";

interface PublishPackage {
	dir: string;
}

interface PackageJson {
	private?: boolean;
}

const repoRoot = path.join(import.meta.dir, "..");
const isDryRun = process.argv.includes("--dry-run");
// Platform-specific native addon packages (published first so optionalDependencies resolve)
const platformPackageDirs: PublishPackage[] = [
	{ dir: "packages/natives/npm/linux-x64-gnu" },
	{ dir: "packages/natives/npm/linux-arm64-gnu" },
	{ dir: "packages/natives/npm/darwin-x64" },
	{ dir: "packages/natives/npm/darwin-arm64" },
	{ dir: "packages/natives/npm/win32-x64-msvc" },
];

const packageDirs: PublishPackage[] = [
	{ dir: "packages/utils" },
	{ dir: "packages/ai" },
	{ dir: "packages/natives" },
	{ dir: "packages/tui" },
	{ dir: "packages/stats" },
	{ dir: "packages/agent" },
	{ dir: "packages/coding-agent" },
];
const alreadyPublishedPatterns = [
	"previously published",
	"cannot publish over",
	"You cannot publish over",
];

function isAlreadyPublished(output: string): boolean {
	return alreadyPublishedPatterns.some((pattern) => output.includes(pattern));
}

async function readPackageJson(packageDir: string): Promise<PackageJson> {
	return (await Bun.file(path.join(repoRoot, packageDir, "package.json")).json()) as PackageJson;
}

async function publishPackage(pkg: PublishPackage): Promise<void> {
	const packageJson = await readPackageJson(pkg.dir);
	const packageName = path.basename(pkg.dir);
	if (packageJson.private) {
		console.log(`Skipping ${packageName} (private)`);
		return;
	}

	if (isDryRun) {
		console.log(`DRY RUN npm publish --access public (${pkg.dir})`);
		return;
	}

	// Use npm publish instead of bun publish — bun publish has a known auth bug in CI
	// https://github.com/oven-sh/bun/issues/24124
	const maxAttempts = 5;
	let delay = 5_000;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		console.log(`Publishing ${packageName}... (attempt ${attempt}/${maxAttempts})`);
		const result = await $`npm publish --access public`.cwd(path.join(repoRoot, pkg.dir)).quiet().nothrow();
		const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
		if (result.exitCode === 0) {
			if (output) console.log(output);
			return;
		}
		if (output) console.log(output);
		if (isAlreadyPublished(output)) {
			console.log("Already published, skipping");
			return;
		}
		if (attempt < maxAttempts) {
			console.log(`Publish failed, retrying in ${delay / 1000}s...`);
			await Bun.sleep(delay);
			delay *= 2;
			continue;
		}
		console.error(`Failed to publish ${packageName} after ${maxAttempts} attempts`);
		process.exit(result.exitCode ?? 1);
	}
}

async function main(): Promise<void> {
	// Publish platform-specific native addon packages first
	// so that optionalDependencies in @f5xc-salesdemos/pi-natives resolve
	console.log("=== Publishing platform-specific native addon packages ===");
	for (const pkg of platformPackageDirs) {
		await publishPackage(pkg);
	}

	console.log("\n=== Publishing main packages ===");
	for (const pkg of packageDirs) {
		await publishPackage(pkg);
	}
}

await main();
