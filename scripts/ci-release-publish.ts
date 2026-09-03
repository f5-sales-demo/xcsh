#!/usr/bin/env bun

import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";

interface PublishPackage {
	dir: string;
}

export interface PackageJson {
	name?: string;
	private?: boolean;
	version?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

export function resolveReleaseSourceRoot(sourceRoot?: string): string {
	if (sourceRoot === undefined || sourceRoot.length === 0) return path.join(import.meta.dir, "..");
	if (!path.isAbsolute(sourceRoot)) throw new Error("XCSH_RELEASE_SOURCE_ROOT must be an absolute path");
	return path.normalize(sourceRoot);
}

function readOption(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	const value = args[index + 1];
	if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
	return value;
}

export function npmPublishArgs(distTag?: string): string[] {
	const args = ["npm", "publish", "--access", "public"];
	if (distTag === undefined) return args;
	if (distTag === "latest") throw new Error("An explicit latest dist-tag is not allowed for release backfills");
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(distTag)) {
		throw new Error(`Malformed npm dist-tag: ${distTag}`);
	}
	return [...args, "--tag", distTag];
}

const repoRoot = resolveReleaseSourceRoot(process.env.XCSH_RELEASE_SOURCE_ROOT);
const isDryRun = process.argv.includes("--dry-run");
const publishTag = readOption(process.argv.slice(2), "--tag");
// Validate once before touching any package or registry.
npmPublishArgs(publishTag);

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
	{ dir: "packages/resource-management" },
	{ dir: "packages/agent" },
	{ dir: "packages/coding-agent" },
];

export function isAlreadyPublished(output: string, version: string): boolean {
	const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return [
		new RegExp(`cannot publish over (?:the )?previously published versions?:?\\s*["']?${escapedVersion}["']?`, "i"),
		new RegExp(`cannot publish over (?:an )?existing version:?\\s*["']?${escapedVersion}["']?`, "i"),
		new RegExp(`cannot publish over (?:the )?previously staged version:?\\s*["']?${escapedVersion}["']?`, "i"),
	].some(pattern => pattern.test(output));
}

export function isExactRegistryVersion(output: string, version: string): boolean {
	try {
		return JSON.parse(output) === version;
	} catch {
		return false;
	}
}

export interface RegistryVisibilityOptions {
	lookup?: (packageName: string, version: string) => Promise<string | null>;
	sleep?: (delayMs: number) => Promise<void>;
	maxAttempts?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
}

async function lookupRegistryVersion(packageName: string, version: string): Promise<string | null> {
	const packageRef = `${packageName}@${version}`;
	const result = await $`npm view ${packageRef} version --json`.cwd(repoRoot).quiet().nothrow();
	if (result.exitCode !== 0) return null;
	return result.stdout.toString().trim();
}

export async function waitForRegistryVisibility(
	packageName: string,
	version: string,
	options: RegistryVisibilityOptions = {},
): Promise<number> {
	const lookup = options.lookup ?? lookupRegistryVersion;
	const sleep = options.sleep ?? Bun.sleep;
	// npm may accept a package before every registry edge can serve it. Keep the
	// wait bounded, but allow the normal propagation tail observed for large
	// release packages rather than failing immediately before it becomes visible.
	const maxAttempts = options.maxAttempts ?? 20;
	const maxDelayMs = options.maxDelayMs ?? 30_000;
	let delayMs = Math.min(options.initialDelayMs ?? 5_000, maxDelayMs);

	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
	if (delayMs < 0 || maxDelayMs < 0) throw new Error("registry visibility delays must be non-negative");

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const output = await lookup(packageName, version);
		if (output !== null && isExactRegistryVersion(output, version)) {
			console.log(`  Registry visibility confirmed for ${packageName}@${version} (${attempt}/${maxAttempts})`);
			return attempt;
		}
		if (attempt === maxAttempts) break;
		console.log(`  Waiting ${delayMs / 1000}s for ${packageName}@${version} registry visibility...`);
		await sleep(delayMs);
		delayMs = Math.min(delayMs * 2, maxDelayMs);
	}

	throw new Error(`${packageName}@${version} was not readable from npm after ${maxAttempts} checks`);
}

interface PublishAttemptResult {
	exitCode: number;
	output: string;
}

export interface PublishAndVisibilityOptions {
	publish: () => Promise<PublishAttemptResult>;
	waitForVisibility: () => Promise<unknown>;
	sleep?: (delayMs: number) => Promise<void>;
	maxAttempts?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
}

/**
 * Retries publication and its visibility check as one bounded operation.
 *
 * npm can accept a large package into staging while its read API continues to
 * return 404. A subsequent publish then reports the exact version as staged.
 * Both responses mean the write was accepted, so keep checking visibility and
 * safely retry the complete operation instead of stranding later packages.
 */
export async function publishWithVisibility(
	packageName: string,
	version: string,
	options: PublishAndVisibilityOptions,
): Promise<number> {
	const sleep = options.sleep ?? Bun.sleep;
	const maxAttempts = options.maxAttempts ?? 7;
	const maxDelayMs = options.maxDelayMs ?? 30_000;
	let delayMs = Math.min(options.initialDelayMs ?? 5_000, maxDelayMs);

	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
	if (delayMs < 0 || maxDelayMs < 0) throw new Error("publish retry delays must be non-negative");

	let lastFailure: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		console.log("Publishing " + packageName + "... (attempt " + attempt + "/" + maxAttempts + ")");
		const result = await options.publish();
		if (result.output) console.log(result.output);

		const accepted = result.exitCode === 0 || isAlreadyPublished(result.output, version);
		if (accepted) {
			if (result.exitCode !== 0) console.log("Exact version already published or staged; checking visibility");
			try {
				await options.waitForVisibility();
				return attempt;
			} catch (error) {
				lastFailure = error;
				if (attempt === maxAttempts) break;
				console.log("  " + packageName + "@" + version + " is still processing; retrying publish and visibility");
			}
		} else {
			lastFailure = new Error(result.output || "npm publish exited with " + result.exitCode);
			if (attempt === maxAttempts) break;
			console.log("Publish failed; retrying publish and visibility");
		}

		await sleep(delayMs);
		delayMs = Math.min(delayMs * 2, maxDelayMs);
	}

	throw new Error(
		packageName +
			"@" +
			version +
			" did not complete publication and visibility after " +
			maxAttempts +
			" attempts",
		{ cause: lastFailure },
	);
}

async function readPackageJson(packageDir: string): Promise<PackageJson> {
	return (await Bun.file(path.join(repoRoot, packageDir, "package.json")).json()) as PackageJson;
}

export function alignNativeOptionalDependencies(packageJson: PackageJson): boolean {
	if (
		packageJson.name !== "@f5-sales-demo/pi-natives" ||
		typeof packageJson.version !== "string" ||
		packageJson.optionalDependencies === undefined
	) {
		return false;
	}

	let changed = false;
	for (const [name, version] of Object.entries(packageJson.optionalDependencies)) {
		if (name.startsWith("@f5-sales-demo/pi-natives-") && version !== packageJson.version) {
			packageJson.optionalDependencies[name] = packageJson.version;
			changed = true;
		}
	}
	return changed;
}

function resolvePublishDependencies(pkgJsonPath: string): (() => void) | null {
	const raw = fs.readFileSync(pkgJsonPath, "utf-8");
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
	changed = alignNativeOptionalDependencies(pkg) || changed;
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
	if (packageJson.name === undefined || packageJson.version === undefined) {
		throw new Error(`${pkg.dir}/package.json must declare name and version before publication`);
	}
	const publishedName = packageJson.name;
	const publishedVersion = packageJson.version;

	if (isDryRun) {
		console.log(`DRY RUN ${npmPublishArgs(publishTag).join(" ")} (${pkg.dir})`);
		return;
	}

	const pkgJsonPath = path.join(repoRoot, pkg.dir, "package.json");
	const restore = resolvePublishDependencies(pkgJsonPath);
	if (restore) console.log(`  Prepared publish dependencies for ${packageName}`);

	try {
		await publishWithVisibility(publishedName, publishedVersion, {
			publish: async () => {
				const publishArgs = npmPublishArgs(publishTag);
				const result = await $`${publishArgs}`.cwd(path.join(repoRoot, pkg.dir)).quiet().nothrow();
				const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
				return { exitCode: result.exitCode, output };
			},
			waitForVisibility: () => waitForRegistryVisibility(publishedName, publishedVersion),
		});
	} finally {
		restore?.();
	}
}

async function main(): Promise<void> {
	// Publish platform-specific native addon packages first
	// so that optionalDependencies in @f5-sales-demo/pi-natives resolve
	console.log("=== Publishing platform-specific native addon packages ===");
	for (const pkg of platformPackageDirs) {
		await publishPackage(pkg);
	}

	console.log("\n=== Publishing main packages ===");
	for (const pkg of packageDirs) {
		await publishPackage(pkg);
	}
}

if (import.meta.main) await main();
