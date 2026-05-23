#!/usr/bin/env bun

import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";

interface PublishPackage {
	dir: string;
}

interface PackageJson {
	private?: boolean;
	version?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
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

function resolveWorkspaceRefs(pkgJsonPath: string): (() => void) | null {
	const raw = fs.readFileSync(pkgJsonPath, "utf-8");
	if (!raw.includes("workspace:")) return null;
	const pkg = JSON.parse(raw) as PackageJson;
	let changed = false;
	for (const depKey of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
		const deps = pkg[depKey];
		if (!deps) continue;
		for (const [name, version] of Object.entries(deps)) {
			if (typeof version === "string" && version.startsWith("workspace:")) {
				const depPkgPath = findWorkspacePackage(name);
				if (depPkgPath) {
					const depPkg = JSON.parse(fs.readFileSync(depPkgPath, "utf-8")) as PackageJson;
					deps[name] = depPkg.version ?? "0.0.0";
					changed = true;
				}
			}
		}
	}
	if (!changed) return null;
	fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, "\t") + "\n");
	return () => fs.writeFileSync(pkgJsonPath, raw);
}

function findWorkspacePackage(name: string): string | null {
	const packagesDir = path.join(repoRoot, "packages");
	for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const pkgPath = path.join(packagesDir, entry.name, "package.json");
		if (!fs.existsSync(pkgPath)) continue;
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
		if (pkg.name === name) return pkgPath;
	}
	return null;
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

	const pkgJsonPath = path.join(repoRoot, pkg.dir, "package.json");
	const restore = resolveWorkspaceRefs(pkgJsonPath);
	if (restore) console.log(`  Resolved workspace:* references for ${packageName}`);

	try {
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
	} finally {
		restore?.();
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
