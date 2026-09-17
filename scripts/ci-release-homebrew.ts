#!/usr/bin/env bun

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { $ } from "bun";

const repoRoot = path.join(import.meta.dir, "..");
const binariesDir = path.join(repoRoot, "packages", "coding-agent", "binaries");
const repo = "f5-sales-demo/xcsh";
const tapRepo = "f5-sales-demo/homebrew-tap";

interface ArchiveTarget {
	binary: string;
	archive: string;
	arch: "arm64" | "x64";
}

const archiveTargets: ArchiveTarget[] = [
	{ binary: "xcsh-darwin-arm64", archive: "xcsh-darwin-arm64.zip", arch: "arm64" },
	{ binary: "xcsh-darwin-x64", archive: "xcsh-darwin-x64.zip", arch: "x64" },
];

const isDryRun = process.argv.includes("--dry-run");
const packageOnly = process.argv.includes("--package-only");
const updateTapOnly = process.argv.includes("--update-tap");

export interface CreateArchivesOptions {
	binariesDir?: string;
	dryRun?: boolean;
	sourceDateEpoch?: string;
}

export interface ComputeChecksumsOptions {
	binariesDir?: string;
	dryRun?: boolean;
}

function getVersion(): string {
	const ref = process.env.GITHUB_REF_NAME || "";
	if (ref.startsWith("v")) return ref.slice(1);
	try {
		const pkg = require(path.join(repoRoot, "packages", "coding-agent", "package.json"));
		return pkg.version;
	} catch {
		throw new Error("Cannot determine version: set GITHUB_REF_NAME or ensure packages/coding-agent/package.json exists");
	}
}

function getTag(): string {
	return process.env.GITHUB_REF_NAME || `v${getVersion()}`;
}

function parseSourceDateEpoch(value: string | undefined): number {
	if (!value || !/^\d+$/.test(value)) {
		throw new Error("SOURCE_DATE_EPOCH is required for deterministic release archives");
	}
	const seconds = Number(value);
	if (!Number.isSafeInteger(seconds)) {
		throw new Error("SOURCE_DATE_EPOCH must be a safe integer");
	}
	return seconds;
}

export async function createArchives(options: CreateArchivesOptions = {}): Promise<void> {
	console.log("Creating macOS archives for Homebrew...");
	const outputDir = options.binariesDir ?? binariesDir;
	const dryRun = options.dryRun ?? isDryRun;
	const sourceDateEpoch = options.sourceDateEpoch ?? process.env.SOURCE_DATE_EPOCH;
	const epochSeconds = dryRun ? undefined : parseSourceDateEpoch(sourceDateEpoch);

	for (const target of archiveTargets) {
		const binaryPath = path.join(outputDir, target.binary);
		const archivePath = path.join(outputDir, target.archive);

		try {
			await fs.stat(binaryPath);
		} catch {
			console.log(`  Skipping ${target.binary} (not found)`);
			continue;
		}

		const nativePrefix = `pi_natives.darwin-${target.arch}`;
		const nativeNames = (await fs.readdir(outputDir))
			.filter(name => name.startsWith(nativePrefix) && name.endsWith(".node"))
			.sort();
		if (nativeNames.length === 0) throw new Error(`No native addons found for darwin-${target.arch}`);

		const tmpDir = await fs.mkdtemp(path.join(repoRoot, ".tmp-homebrew-"));
		try {
			const stagedBinary = path.join(tmpDir, "bin", "xcsh");
			await fs.mkdir(path.dirname(stagedBinary), { recursive: true });
			await fs.copyFile(binaryPath, stagedBinary);

			const stagedFiles = [stagedBinary];
			for (const name of nativeNames) {
				const stagedAddon = path.join(tmpDir, "libexec", name);
				await fs.mkdir(path.dirname(stagedAddon), { recursive: true });
				await fs.copyFile(path.join(outputDir, name), stagedAddon);
				stagedFiles.push(stagedAddon);
			}
			await fs.rm(archivePath, { force: true });

			const archiveEntries = ["bin/xcsh", ...nativeNames.map(name => `libexec/${name}`)];
			if (dryRun) {
				console.log(`  DRY RUN: zip -X ${archivePath} ${archiveEntries.join(" ")}`);
				continue;
			}

			if (epochSeconds === undefined) throw new Error("SOURCE_DATE_EPOCH was not resolved");
			for (const stagedFile of stagedFiles) await fs.utimes(stagedFile, epochSeconds, epochSeconds);
			await $`zip -X ${archivePath} ${archiveEntries}`.cwd(tmpDir).quiet();
			console.log(`  Created ${target.archive}`);
		} finally {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	}
}

export async function computeChecksums(options: ComputeChecksumsOptions = {}): Promise<Map<string, string>> {
	const outputDir = options.binariesDir ?? binariesDir;
	const dryRun = options.dryRun ?? isDryRun;
	const checksums = new Map<string, string>();

	for (const target of archiveTargets) {
		const archivePath = path.join(outputDir, target.archive);
		try {
			await fs.stat(archivePath);
		} catch {
			continue;
		}

		if (dryRun) {
			checksums.set(target.archive, "0".repeat(64));
			console.log(`  DRY RUN: sha256 ${target.archive}`);
			continue;
		}

		const bytes = await fs.readFile(archivePath);
		const sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
		checksums.set(target.archive, sha);
		console.log(`  ${target.archive}: ${sha}`);
	}

	return checksums;
}

export function generateCask(version: string, tag: string, checksums: Map<string, string>): string {
	if (tag !== `v${version}`) throw new Error(`Release tag ${tag} does not match version ${version}`);
	const requiredChecksum = (archive: string): string => {
		const checksum = checksums.get(archive);
		if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) {
			throw new Error(`Missing or invalid SHA-256 for ${archive}`);
		}
		return checksum;
	};
	const armSha = requiredChecksum("xcsh-darwin-arm64.zip");
	const intelSha = requiredChecksum("xcsh-darwin-x64.zip");
	return `cask "xcsh" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${armSha}",
         intel: "${intelSha}"

  url "https://github.com/${repo}/releases/download/v#{version}/xcsh-darwin-#{arch}.zip"
  name "xcsh"
  desc "AI coding agent for the terminal"
  homepage "https://github.com/${repo}"

  depends_on formula: "ripgrep"

  binary "bin/xcsh"

  postflight_steps do
    run "bin/xcsh", args: ["chrome", "recycle"], base: :staged_path,
                    sudo: false, must_succeed: false
    run "bin/xcsh", args: ["office", "recycle"], base: :staged_path,
                    sudo: false, must_succeed: false
  end
end
`;
}

export async function replaceTapDefinitions(tapDir: string, cask: string): Promise<void> {
	await Bun.write(path.join(tapDir, "Casks", "xcsh.rb"), cask);
	await fs.rm(path.join(tapDir, "xcsh.rb"), { force: true });
}

async function updateTap(version: string, tag: string, checksums: Map<string, string>): Promise<void> {
	const ghToken = process.env.GH_TOKEN;
	if (!ghToken && !isDryRun) {
		throw new Error("GH_TOKEN is required to push to the Homebrew tap");
	}

	const cask = generateCask(version, tag, checksums);

	if (isDryRun) {
		console.log("\nGenerated cask:\n");
		console.log(cask);
		console.log("DRY RUN: would replace Casks/xcsh.rb, delete xcsh.rb, and push to", tapRepo);
		return;
	}

	const tmpDir = "/tmp/homebrew-tap";
	await fs.rm(tmpDir, { recursive: true, force: true });

	console.log(`Cloning ${tapRepo}...`);
	await $`git clone https://x-access-token:${ghToken}@github.com/${tapRepo}.git ${tmpDir}`;

	await replaceTapDefinitions(tmpDir, cask);

	const changed = (await $`git -C ${tmpDir} status --porcelain -- xcsh.rb Casks/xcsh.rb`.text()).trim();
	if (!changed) {
		console.log("No changes to tap cask — skipping push");
		return;
	}

	await $`git -C ${tmpDir} config user.name "github-actions[bot]"`;
	await $`git -C ${tmpDir} config user.email "41898282+github-actions[bot]@users.noreply.github.com"`;
	await $`git -C ${tmpDir} add --all -- xcsh.rb Casks/xcsh.rb`;
	await $`git -C ${tmpDir} commit -m ${"Update xcsh cask to " + tag}`;
	await $`git -C ${tmpDir} push`;
	console.log(`Pushed updated cask to ${tapRepo}`);
}

async function main(): Promise<void> {
	const version = getVersion();
	const tag = getTag();
	console.log(`Homebrew release: version=${version} tag=${tag}`);

	if (!updateTapOnly) {
		await createArchives();
	}

	if (!packageOnly) {
		console.log("\nComputing checksums...");
		const checksums = await computeChecksums();
		await updateTap(version, tag, checksums);
	}
}

if (import.meta.main) await main();
