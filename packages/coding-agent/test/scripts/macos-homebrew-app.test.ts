import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { generateCask } from "../../../../scripts/ci-release-homebrew";
import { createMacOsProvenanceManifest, verifyMacOsProvenance } from "../../../../scripts/macos-release-provenance";

const { getNativeLoadChannel } = require("../../../../packages/natives/native/installed-paths.js");
const checksums = new Map([
	["xcsh-darwin-arm64.zip", "a".repeat(64)],
	["xcsh-darwin-x64.zip", "b".repeat(64)],
	["xcsh-darwin-arm64.dmg", "c".repeat(64)],
	["xcsh-darwin-x64.dmg", "d".repeat(64)],
]);

test("new Homebrew releases select the stapled DMG and versioned app executable", () => {
	const cask = generateCask("25.2.4", "v25.2.4", checksums);
	expect(cask).toContain("xcsh-darwin-#{arch}.dmg");
	expect(cask).toContain('executable_path = "xcsh.app/Contents/MacOS/xcsh-darwin-#{arch}"');
	expect(cask).toContain('binary executable_path, target: "xcsh"');
	expect(cask).toContain(`sha256 arm:   "${"c".repeat(64)}"`);
	expect(cask).not.toMatch(/no-quarantine|xattr|sudo: true|^\s*pkg\s/m);
});

test("new Homebrew releases reject a bare ZIP-only publication", () => {
	expect(() =>
		generateCask(
			"25.2.4",
			"v25.2.4",
			new Map([
				["xcsh-darwin-arm64.zip", "a".repeat(64)],
				["xcsh-darwin-x64.zip", "b".repeat(64)],
			]),
		),
	).toThrow("xcsh-darwin-arm64.dmg");
});

test("the approved app Caskroom path loads only its fixed signed native addon", () => {
	const channel = getNativeLoadChannel({
		platform: "darwin",
		addonFilenames: ["pi_natives.darwin-arm64.node"],
		rawExecPath: "/opt/homebrew/bin/xcsh",
		resolvedExecPath: "/opt/homebrew/Caskroom/xcsh/25.2.4/xcsh.app/Contents/MacOS/xcsh-darwin-arm64",
		packageVersion: "25.2.4",
	});
	expect(channel).toEqual({
		mode: "installed-only",
		candidates: ["/opt/homebrew/Caskroom/xcsh/25.2.4/xcsh.app/Contents/libexec/pi_natives.darwin-arm64.node"],
	});
});

test("app provenance binds the copied CLI and native bytes to the app inventory", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-app-contract-"));
	try {
		const binary = path.join(root, "xcsh.app/Contents/MacOS/xcsh-darwin-arm64");
		const nativeDir = path.join(root, "xcsh.app/Contents/libexec");
		await fs.mkdir(path.dirname(binary), { recursive: true });
		await fs.mkdir(nativeDir, { recursive: true });
		await Bun.write(binary, "synthetic signed CLI");
		await Bun.write(path.join(nativeDir, "pi_natives.darwin-arm64.node"), "synthetic signed addon");
		const inspect = async (file: string) => ({
			authority: "Developer ID Application",
			teamIdentifier: "97ZYL78T5F",
			hardenedRuntime: true,
			trustedTimestamp: true,
			notarized: true,
			architectures: ["arm64"],
			entitlements: file.endsWith(".node")
				? []
				: ["com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory"],
		});
		const manifest = await createMacOsProvenanceManifest({
			arch: "arm64",
			version: "25.2.4",
			binaryPath: binary,
			nativeDir,
			inspectSignature: inspect,
		});
		await Bun.write(path.join(root, "provenance/manifest.json"), JSON.stringify(manifest));
		await verifyMacOsProvenance({
			manifest,
			rootDir: root,
			layout: "app" as Parameters<typeof verifyMacOsProvenance>[0]["layout"],
			inspectSignature: inspect,
			rejectUnexpected: true,
		});
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

import { appInfoPlist, stageMacOsHomebrewApp } from "../../../../scripts/ci-release-macos-app";

async function sourceFixture(arch: "arm64" | "x64" = "arm64") {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-app-stage-"));
	const source = path.join(root, "source");
	await fs.mkdir(source);
	await Bun.write(path.join(source, `xcsh-darwin-${arch}`), "synthetic source CLI");
	const nativeNames =
		arch === "arm64"
			? ["pi_natives.darwin-arm64.node"]
			: ["pi_natives.darwin-x64-baseline.node", "pi_natives.darwin-x64-modern.node"];
	for (const name of nativeNames) await Bun.write(path.join(source, name), `synthetic ${name}`);
	const manifest = await createMacOsProvenanceManifest({
		arch,
		version: "25.2.4",
		binaryPath: path.join(source, `xcsh-darwin-${arch}`),
		nativeDir: source,
		inspectSignature: async file => ({
			authority: "Developer ID Application",
			teamIdentifier: "97ZYL78T5F",
			hardenedRuntime: true,
			trustedTimestamp: true,
			notarized: true,
			architectures: [arch === "arm64" ? "arm64" : "x86_64"],
			entitlements: file.endsWith(".node")
				? []
				: ["com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory"],
		}),
	});
	await Bun.write(path.join(source, `xcsh-darwin-${arch}.provenance.json`), JSON.stringify(manifest));
	return { root, source, manifest, nativeNames };
}

test.each(["arm64", "x64"] as const)("stages the closed %s app payload from exact source bytes", async arch => {
	const f = await sourceFixture(arch);
	try {
		const app = await stageMacOsHomebrewApp({
			arch,
			version: "25.2.4",
			binariesDir: f.source,
			rootDir: path.join(f.root, "staged"),
		});
		expect(await Bun.file(app.binaryPath).text()).toBe("synthetic source CLI");
		expect((await fs.readdir(app.nativeDir)).sort()).toEqual(f.nativeNames.sort());
		expect(await Bun.file(path.join(app.appDir, "Contents/Info.plist")).text()).toBe(appInfoPlist(arch, "25.2.4"));
		for (const name of f.nativeNames)
			expect(await Bun.file(path.join(app.nativeDir, name)).text()).toBe(`synthetic ${name}`);
	} finally {
		await fs.rm(f.root, { recursive: true, force: true });
	}
});

test("refuses tampered source code before staging a signed app", async () => {
	const f = await sourceFixture();
	try {
		await Bun.write(path.join(f.source, "xcsh-darwin-arm64"), "tampered bytes");
		await expect(
			stageMacOsHomebrewApp({
				arch: "arm64",
				version: "25.2.4",
				binariesDir: f.source,
				rootDir: path.join(f.root, "staged"),
			}),
		).rejects.toThrow("hash mismatch");
		expect(await Bun.file(path.join(f.root, "staged/xcsh.app/Contents/Info.plist")).exists()).toBe(false);
	} finally {
		await fs.rm(f.root, { recursive: true, force: true });
	}
});

test("refuses unsigned provenance and source symlinks", async () => {
	const f = await sourceFixture();
	try {
		const manifestPath = path.join(f.source, "xcsh-darwin-arm64.provenance.json");
		f.manifest.files[0].signature.authority = "adhoc";
		await Bun.write(manifestPath, JSON.stringify(f.manifest));
		await expect(
			stageMacOsHomebrewApp({
				arch: "arm64",
				version: "25.2.4",
				binariesDir: f.source,
				rootDir: path.join(f.root, "unsigned"),
			}),
		).rejects.toThrow("not Developer ID Application signed");
		f.manifest.files[0].signature.authority = "Developer ID Application";
		await Bun.write(manifestPath, JSON.stringify(f.manifest));
		const addon = path.join(f.source, f.nativeNames[0]);
		await fs.rename(addon, `${addon}.backup`);
		await fs.symlink(`${addon}.backup`, addon);
		await expect(
			stageMacOsHomebrewApp({
				arch: "arm64",
				version: "25.2.4",
				binariesDir: f.source,
				rootDir: path.join(f.root, "symlink"),
			}),
		).rejects.toThrow("regular files");
	} finally {
		await fs.rm(f.root, { recursive: true, force: true });
	}
});

test("preserves an existing staging directory and rejects version injection", async () => {
	const f = await sourceFixture();
	try {
		const rootDir = path.join(f.root, "existing");
		await fs.mkdir(rootDir);
		await Bun.write(path.join(rootDir, "preserve"), "owned bytes");
		await expect(
			stageMacOsHomebrewApp({ arch: "arm64", version: "25.2.4", binariesDir: f.source, rootDir }),
		).rejects.toThrow("must be empty");
		expect(await Bun.file(path.join(rootDir, "preserve")).text()).toBe("owned bytes");
		expect(() => appInfoPlist("arm64", "25.2.4</string>")).toThrow("Invalid app version");
	} finally {
		await fs.rm(f.root, { recursive: true, force: true });
	}
});

test("an app version mismatch cannot select an embedded unsigned fallback", () => {
	const channel = getNativeLoadChannel({
		platform: "darwin",
		addonFilenames: ["pi_natives.darwin-arm64.node"],
		rawExecPath: "/opt/homebrew/bin/xcsh",
		resolvedExecPath: "/opt/homebrew/Caskroom/xcsh/25.2.4/xcsh.app/Contents/MacOS/xcsh-darwin-arm64",
		packageVersion: "25.2.5",
	});
	expect(channel).toEqual({ mode: "installed-only", candidates: [] });
});

import { reconcileReleases } from "../../../../scripts/ci-reconcile-releases";

test("release reconciliation checks the published DMG digests", async () => {
	const result = await reconcileReleases({
		listTags: async () => ["v25.2.4"],
		listReleases: async () => ["v25.2.4"],
		listNpmVersions: async () => ["25.2.4"],
		readHomebrewCask: async () => generateCask("25.2.4", "v25.2.4", checksums),
		listAssetDigests: async () =>
			new Map([
				["xcsh-darwin-arm64.dmg", "c".repeat(64)],
				["xcsh-darwin-x64.dmg", "d".repeat(64)],
			]),
		log: () => {},
	});
	expect(result.status).toBe("clean");
});

test("release reconciliation rejects a changed notarized image digest", async () => {
	const result = await reconcileReleases({
		listTags: async () => ["v25.2.4"],
		listReleases: async () => ["v25.2.4"],
		listNpmVersions: async () => ["25.2.4"],
		readHomebrewCask: async () => generateCask("25.2.4", "v25.2.4", checksums),
		listAssetDigests: async () =>
			new Map([
				["xcsh-darwin-arm64.dmg", "c".repeat(64)],
				["xcsh-darwin-x64.dmg", "e".repeat(64)],
			]),
		log: () => {},
	});
	expect(result.status).toBe("diverged");
	expect(result.divergences[0]?.brokenHomebrew).toBe(true);
});

test("the standard-account app verifier needs no Bun checkout or runtime", async () => {
	const script = await Bun.file(path.join(import.meta.dir, "../../../../scripts/ci-verify-homebrew-cask.sh")).text();
	expect(script).not.toContain("$(bun ");
	expect(script).toContain("verify_macos_app_payload.py");
});
