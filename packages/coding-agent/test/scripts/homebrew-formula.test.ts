import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";
import {
	computeChecksums,
	createArchives,
	generateCask,
	replaceTapDefinitions,
} from "../../../../scripts/ci-release-homebrew";

describe("macOS Homebrew binary cask", () => {
	const armSha = "a".repeat(64);
	const intelSha = "b".repeat(64);
	const cask = generateCask(
		"19.99.0",
		"v19.99.0",
		new Map([
			["xcsh-darwin-x64.zip", intelSha],
			["xcsh-darwin-arm64.zip", armSha],
		]),
	);

	it("installs the signed ZIP for both macOS architectures", () => {
		expect(cask).toContain('cask "xcsh" do');
		expect(cask).toContain('arch arm: "arm64", intel: "x64"');
		expect(cask).toContain(`sha256 arm:   "${armSha}",\n         intel: "${intelSha}"`);
		expect(cask).toContain(
			'url "https://github.com/f5-sales-demo/xcsh/releases/download/v#{version}/xcsh-darwin-#{arch}.zip"',
		);
		expect(cask).toContain('depends_on formula: "ripgrep"');
		expect(cask).toContain('binary "bin/xcsh"');
	});

	it("uses non-privileged best-effort postflight recycling", () => {
		expect(cask).toContain("postflight_steps do");
		expect(cask).toContain('run "bin/xcsh", args: ["chrome", "recycle"], base: :staged_path');
		expect(cask).toContain('run "bin/xcsh", args: ["office", "recycle"], base: :staged_path');
		expect(cask).toContain('args: ["chrome", "recycle"]');
		expect(cask).toContain('args: ["office", "recycle"]');
		expect(cask.match(/sudo: false/g)?.length).toBe(2);
		expect(cask.match(/must_succeed: false/g)?.length).toBe(2);
	});

	it("contains no package or privileged uninstall behavior", () => {
		expect(cask).not.toMatch(/\.pkg\b/);
		expect(cask).not.toContain("pkgutil");
		expect(cask).not.toMatch(/^\s*pkg\s/m);
		expect(cask).not.toContain("uninstall");
		expect(cask).not.toContain("sudo: true");
	});

	it("refuses to publish without both architecture checksums", () => {
		expect(() => generateCask("19.99.0", "v19.99.0", new Map([["xcsh-darwin-arm64.zip", armSha]]))).toThrow(
			"Missing or invalid SHA-256 for xcsh-darwin-x64.zip",
		);
	});

	it("refuses a release tag that does not match the cask version", () => {
		expect(() =>
			generateCask(
				"19.99.0",
				"v19.98.0",
				new Map([
					["xcsh-darwin-arm64.zip", armSha],
					["xcsh-darwin-x64.zip", intelSha],
				]),
			),
		).toThrow("Release tag v19.98.0 does not match version 19.99.0");
	});
});

describe("Homebrew release archives", () => {
	it("creates deterministic macOS ZIPs with the Caskroom layout and source bytes", async () => {
		const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-homebrew-archive-test-"));
		const epochSeconds = 1_700_000_000;
		const armArchivePath = path.join(fixtureDir, "xcsh-darwin-arm64.zip");
		const intelArchivePath = path.join(fixtureDir, "xcsh-darwin-x64.zip");

		try {
			const binaryPath = path.join(fixtureDir, "xcsh-darwin-arm64");
			const addonPath = path.join(fixtureDir, "pi_natives.darwin-arm64.node");
			await Bun.write(binaryPath, "synthetic xcsh binary\n");
			await fs.chmod(binaryPath, 0o755);
			await Bun.write(addonPath, "synthetic native addon\n");
			await Bun.write(path.join(fixtureDir, "xcsh-darwin-x64"), "synthetic Intel xcsh binary\n");
			await fs.chmod(path.join(fixtureDir, "xcsh-darwin-x64"), 0o755);
			await Bun.write(path.join(fixtureDir, "pi_natives.darwin-x64-baseline.node"), "Intel baseline addon\n");
			await Bun.write(path.join(fixtureDir, "pi_natives.darwin-x64-modern.node"), "Intel modern addon\n");
			const options = {
				binariesDir: fixtureDir,
				dryRun: false,
				sourceDateEpoch: String(epochSeconds),
			};

			await createArchives(options);
			const firstArmArchive = await fs.readFile(armArchivePath);
			const firstIntelArchive = await fs.readFile(intelArchivePath);
			await createArchives(options);
			expect(await fs.readFile(armArchivePath)).toEqual(firstArmArchive);
			expect(await fs.readFile(intelArchivePath)).toEqual(firstIntelArchive);

			const armEntries = (await $`unzip -Z1 ${armArchivePath}`.text()).trim().split("\n");
			expect(armEntries).toEqual(["bin/xcsh", "libexec/pi_natives.darwin-arm64.node"]);
			const intelEntries = (await $`unzip -Z1 ${intelArchivePath}`.text()).trim().split("\n");
			expect(intelEntries).toEqual([
				"bin/xcsh",
				"libexec/pi_natives.darwin-x64-baseline.node",
				"libexec/pi_natives.darwin-x64-modern.node",
			]);

			const extractDir = path.join(fixtureDir, "extracted");
			await fs.mkdir(extractDir);
			await $`unzip -q ${armArchivePath} -d ${extractDir}`.quiet();
			const archivedBinaryPath = path.join(extractDir, "bin", "xcsh");
			const archivedAddonPath = path.join(extractDir, "libexec", "pi_natives.darwin-arm64.node");
			const archivedBinary = await fs.stat(archivedBinaryPath);
			expect(await fs.readFile(archivedBinaryPath)).toEqual(await fs.readFile(binaryPath));
			expect(await fs.readFile(archivedAddonPath)).toEqual(await fs.readFile(addonPath));
			expect(archivedBinary.mode & 0o111).not.toBe(0);
			expect(Math.floor(archivedBinary.mtimeMs / 1000)).toBe(epochSeconds);
		} finally {
			await fs.rm(fixtureDir, { recursive: true, force: true });
		}
	});

	it("computes architecture-specific ZIP checksums only", async () => {
		const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-homebrew-checksum-test-"));
		try {
			await Bun.write(path.join(fixtureDir, "xcsh-darwin-arm64.zip"), "arm archive");
			await Bun.write(path.join(fixtureDir, "xcsh-darwin-x64.zip"), "intel archive");
			await Bun.write(path.join(fixtureDir, "xcsh-linux-x64.tar.gz"), "obsolete archive");
			await Bun.write(path.join(fixtureDir, "xcsh-darwin-arm64.pkg"), "mdm package");

			const checksums = await computeChecksums({ binariesDir: fixtureDir });
			expect([...checksums.keys()]).toEqual(["xcsh-darwin-arm64.zip", "xcsh-darwin-x64.zip"]);
			expect(checksums.get("xcsh-darwin-arm64.zip")).toBe(
				new Bun.CryptoHasher("sha256").update("arm archive").digest("hex"),
			);
			expect(checksums.get("xcsh-darwin-x64.zip")).toBe(
				new Bun.CryptoHasher("sha256").update("intel archive").digest("hex"),
			);
		} finally {
			await fs.rm(fixtureDir, { recursive: true, force: true });
		}
	});
});

describe("Homebrew tap replacement", () => {
	it("deletes the obsolete formula while replacing the cask", async () => {
		const tapDir = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-homebrew-tap-test-"));
		const replacementCask = generateCask(
			"19.99.0",
			"v19.99.0",
			new Map([
				["xcsh-darwin-x64.zip", "b".repeat(64)],
				["xcsh-darwin-arm64.zip", "a".repeat(64)],
			]),
		);
		try {
			await Bun.write(path.join(tapDir, "xcsh.rb"), "class Xcsh < Formula; end\n");
			await Bun.write(path.join(tapDir, "Casks", "xcsh.rb"), "old cask\n");

			await replaceTapDefinitions(tapDir, replacementCask);

			expect(await Bun.file(path.join(tapDir, "Casks", "xcsh.rb")).text()).toBe(replacementCask);
			await expect(fs.stat(path.join(tapDir, "xcsh.rb"))).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await fs.rm(tapDir, { recursive: true, force: true });
		}
	});
});
