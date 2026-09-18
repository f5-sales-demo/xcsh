import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	createMacOsProvenanceManifest,
	type MacOsSignature,
	verifyMacOsProvenance,
} from "../../../../scripts/macos-release-provenance";

const validBinarySignature: MacOsSignature = {
	authority: "Developer ID Application",
	teamIdentifier: "97ZYL78T5F",
	hardenedRuntime: true,
	trustedTimestamp: true,
	notarized: true,
	entitlements: ["com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory"],
	architectures: ["arm64"],
};
const validAddonSignature: MacOsSignature = { ...validBinarySignature, entitlements: [] };

describe("macOS release provenance", () => {
	it("binds the exact architecture payload and verifies copied bytes and signatures", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-provenance-"));
		try {
			const binaryPath = path.join(root, "xcsh-darwin-arm64");
			const nativeDir = path.join(root, "native");
			const addonPath = path.join(nativeDir, "pi_natives.darwin-arm64.node");
			await fs.mkdir(nativeDir);
			await Bun.write(binaryPath, "signed cli");
			await Bun.write(addonPath, "signed addon");
			const inspect = async (file: string) => (file.endsWith(".node") ? validAddonSignature : validBinarySignature);

			const manifest = await createMacOsProvenanceManifest({
				arch: "arm64",
				version: "21.32.1",
				binaryPath,
				nativeDir,
				inspectSignature: inspect,
			});
			expect(manifest.files.map(file => file.name)).toEqual(["xcsh-darwin-arm64", "pi_natives.darwin-arm64.node"]);

			const staged = path.join(root, "staged");
			await fs.mkdir(path.join(staged, "bin"), { recursive: true });
			await fs.mkdir(path.join(staged, "libexec"), { recursive: true });
			await fs.copyFile(binaryPath, path.join(staged, "bin", "xcsh"));
			await fs.copyFile(addonPath, path.join(staged, "libexec", path.basename(addonPath)));
			await verifyMacOsProvenance({ manifest, rootDir: staged, layout: "homebrew", inspectSignature: inspect });
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("reports both hash and strict-signature failure for a tampered copy", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-provenance-tamper-"));
		try {
			const binaryPath = path.join(root, "xcsh-darwin-arm64");
			const nativeDir = path.join(root, "native");
			const addonPath = path.join(nativeDir, "pi_natives.darwin-arm64.node");
			await fs.mkdir(nativeDir);
			await Bun.write(binaryPath, "signed cli");
			await Bun.write(addonPath, "signed addon");
			const manifest = await createMacOsProvenanceManifest({
				arch: "arm64",
				version: "21.32.1",
				binaryPath,
				nativeDir,
				inspectSignature: async file => (file.endsWith(".node") ? validAddonSignature : validBinarySignature),
			});
			await Bun.write(binaryPath, "tampered cli");
			await expect(
				verifyMacOsProvenance({
					manifest,
					rootDir: root,
					layout: "release",
					inspectSignature: async file => {
						if (file === binaryPath) throw new Error("codesign strict verification failed");
						return validAddonSignature;
					},
				}),
			).rejects.toThrow(/hash mismatch[\s\S]*codesign strict verification failed/);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("permits only its exact architecture-bound manifest in release staging", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-provenance-release-staging-"));
		try {
			const binaryPath = path.join(root, "xcsh-darwin-arm64");
			const addonPath = path.join(root, "pi_natives.darwin-arm64.node");
			const inspect = async (file: string) => (file.endsWith(".node") ? validAddonSignature : validBinarySignature);
			await Bun.write(binaryPath, "signed cli");
			await Bun.write(addonPath, "signed addon");
			const manifest = await createMacOsProvenanceManifest({
				arch: "arm64",
				version: "21.33.1",
				binaryPath,
				nativeDir: root,
				inspectSignature: inspect,
			});

			await Bun.write(path.join(root, "xcsh-darwin-arm64.provenance.json"), JSON.stringify(manifest));
			await verifyMacOsProvenance({
				manifest,
				rootDir: root,
				layout: "release",
				inspectSignature: inspect,
				rejectUnexpected: true,
			});

			await Bun.write(path.join(root, "xcsh-darwin-x64.provenance.json"), "lookalike manifest");
			await expect(
				verifyMacOsProvenance({
					manifest,
					rootDir: root,
					layout: "release",
					inspectSignature: inspect,
					rejectUnexpected: true,
				}),
			).rejects.toThrow("xcsh-darwin-x64.provenance.json: unexpected file");
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("rejects the wrong team, architecture, entitlement, and unexpected files", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-provenance-policy-"));
		try {
			const binaryPath = path.join(root, "xcsh-darwin-arm64");
			const nativeDir = path.join(root, "native");
			await fs.mkdir(nativeDir);
			await Bun.write(binaryPath, "binary");
			await Bun.write(path.join(nativeDir, "pi_natives.darwin-x64-modern.node"), "wrong arch");
			await expect(
				createMacOsProvenanceManifest({
					arch: "arm64",
					version: "21.32.1",
					binaryPath,
					nativeDir,
					inspectSignature: async () => validBinarySignature,
				}),
			).rejects.toThrow("unexpected native addon");

			await fs.rm(path.join(nativeDir, "pi_natives.darwin-x64-modern.node"));
			await Bun.write(path.join(nativeDir, "pi_natives.darwin-arm64.node"), "addon");
			await expect(
				createMacOsProvenanceManifest({
					arch: "arm64",
					version: "21.32.1",
					binaryPath,
					nativeDir,
					inspectSignature: async file =>
						file.endsWith(".node")
							? validAddonSignature
							: {
									...validBinarySignature,
									teamIdentifier: "WRONGTEAM",
									entitlements: [
										...validBinarySignature.entitlements,
										"com.apple.security.cs.disable-library-validation",
									],
								},
				}),
			).rejects.toThrow(/team identifier[\s\S]*entitlements/);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it.each(["adhoc", "unsigned"])("rejects a %s payload", async authority => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-provenance-signature-"));
		try {
			const binaryPath = path.join(root, "xcsh-darwin-arm64");
			const nativeDir = path.join(root, "native");
			await fs.mkdir(nativeDir);
			await Bun.write(binaryPath, "binary");
			await Bun.write(path.join(nativeDir, "pi_natives.darwin-arm64.node"), "addon");
			await expect(
				createMacOsProvenanceManifest({
					arch: "arm64",
					version: "21.32.1",
					binaryPath,
					nativeDir,
					inspectSignature: async file => ({
						...(file.endsWith(".node") ? validAddonSignature : validBinarySignature),
						authority,
					}),
				}),
			).rejects.toThrow("not Developer ID Application signed");
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a manifest that omits an expected payload", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-provenance-inventory-"));
		try {
			await expect(
				verifyMacOsProvenance({
					manifest: {
						schemaVersion: 1,
						arch: "arm64",
						version: "21.32.1",
						teamIdentifier: "97ZYL78T5F",
						files: [],
					},
					rootDir: root,
					layout: "release",
					inspectSignature: false,
				}),
			).rejects.toThrow("unexpected manifest file inventory");
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("checks only package-owned paths when validating an installed package", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-provenance-pkg-inventory-"));
		try {
			const binaryPath = path.join(root, "xcsh-darwin-arm64");
			const nativeDir = path.join(root, "native");
			const addonName = "pi_natives.darwin-arm64.node";
			const inspect = async (file: string) => (file.endsWith(".node") ? validAddonSignature : validBinarySignature);
			await fs.mkdir(nativeDir);
			await Bun.write(binaryPath, "signed cli");
			await Bun.write(path.join(nativeDir, addonName), "signed addon");
			const manifest = await createMacOsProvenanceManifest({
				arch: "arm64",
				version: "21.33.1",
				binaryPath,
				nativeDir,
				inspectSignature: inspect,
			});
			const installedBinary = path.join(root, "usr/local/bin/xcsh");
			const installedNatives = path.join(root, "Library/Application Support/xcsh/natives/21.33.1");
			await fs.mkdir(path.dirname(installedBinary), { recursive: true });
			await fs.mkdir(installedNatives, { recursive: true });
			await fs.copyFile(binaryPath, installedBinary);
			await fs.copyFile(path.join(nativeDir, addonName), path.join(installedNatives, addonName));
			await Bun.write(path.join(installedNatives, "provenance.json"), JSON.stringify(manifest));
			await Bun.write(path.join(root, "unrelated-system-file"), "not package payload");

			await verifyMacOsProvenance({
				manifest,
				rootDir: root,
				layout: "pkg",
				inspectSignature: inspect,
				rejectUnexpected: true,
			});

			await Bun.write(path.join(installedNatives, "unexpected"), "extra");
			await expect(
				verifyMacOsProvenance({
					manifest,
					rootDir: root,
					layout: "pkg",
					inspectSignature: inspect,
					rejectUnexpected: true,
				}),
			).rejects.toThrow("unexpected file");
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a correctly named payload with the wrong Mach-O architecture", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-provenance-architecture-"));
		try {
			const binaryPath = path.join(root, "xcsh-darwin-arm64");
			const nativeDir = path.join(root, "native");
			await fs.mkdir(nativeDir);
			await Bun.write(binaryPath, "binary");
			await Bun.write(path.join(nativeDir, "pi_natives.darwin-arm64.node"), "addon");
			await expect(
				createMacOsProvenanceManifest({
					arch: "arm64",
					version: "21.32.1",
					binaryPath,
					nativeDir,
					inspectSignature: async file => ({
						...(file.endsWith(".node") ? validAddonSignature : validBinarySignature),
						architectures: ["x86_64"],
					}),
				}),
			).rejects.toThrow("wrong architecture");
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
