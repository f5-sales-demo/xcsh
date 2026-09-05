#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface StageMacOsPackageOptions {
	arch: "arm64" | "x64";
	version: string;
	binaryPath: string;
	nativeDir: string;
	rootDir: string;
}

export async function stageMacOsPackage(options: StageMacOsPackageOptions): Promise<string[]> {
	const { arch, version, binaryPath, nativeDir, rootDir } = options;
	if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`);

	const binaryTarget = path.join(rootDir, "usr", "local", "bin", "xcsh");
	const nativeTargetDir = path.join(rootDir, "Library", "Application Support", "xcsh", "natives", version);
	await fs.mkdir(path.dirname(binaryTarget), { recursive: true });
	await fs.mkdir(nativeTargetDir, { recursive: true });
	await fs.copyFile(binaryPath, binaryTarget);
	await fs.chmod(binaryTarget, 0o755);

	const prefix = `pi_natives.darwin-${arch}`;
	const nativeNames = (await fs.readdir(nativeDir))
		.filter(name => name.startsWith(prefix) && name.endsWith(".node"))
		.sort();
	if (nativeNames.length === 0) throw new Error(`No signed native addons found for darwin-${arch}`);

	const staged = [binaryTarget];
	for (const name of nativeNames) {
		const target = path.join(nativeTargetDir, name);
		await fs.copyFile(path.join(nativeDir, name), target);
		await fs.chmod(target, 0o755);
		staged.push(target);
	}
	return staged;
}

function argument(name: string): string {
	const index = process.argv.indexOf(name);
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	if (!value) throw new Error(`${name} is required`);
	return value;
}

async function main(): Promise<void> {
	if (process.platform !== "darwin") throw new Error("macOS pkg creation must run on macOS");
	const arch = argument("--arch");
	if (arch !== "arm64" && arch !== "x64") throw new Error(`Unsupported architecture: ${arch}`);
	const version = argument("--version");
	const binaryPath = argument("--binary");
	const nativeDir = argument("--native-dir");
	const outputPath = argument("--output");
	const signingIdentity = process.env.INSTALLER_SIGNING_IDENTITY;
	if (!signingIdentity?.includes("Developer ID Installer")) {
		throw new Error("INSTALLER_SIGNING_IDENTITY must name a Developer ID Installer identity");
	}

	const rootDir = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "xcsh-pkg-root-"));
	try {
		const staged = await stageMacOsPackage({ arch, version, binaryPath, nativeDir, rootDir });
		console.log(`Staged ${staged.length} signed executable file(s) for xcsh ${version} (${arch})`);
		await fs.mkdir(path.dirname(outputPath), { recursive: true });
		const proc = Bun.spawn(
			[
				"pkgbuild",
				"--root",
				rootDir,
				"--identifier",
				"com.f5.xcsh",
				"--version",
				version,
				"--install-location",
				"/",
				"--sign",
				signingIdentity,
				outputPath,
			],
			{ stdout: "inherit", stderr: "inherit" },
		);
		const exitCode = await proc.exited;
		if (exitCode !== 0) throw new Error(`pkgbuild failed with exit code ${exitCode}`);
	} finally {
		await fs.rm(rootDir, { recursive: true, force: true });
	}
}

if (import.meta.main) await main();
