import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createNativeManifest, verifyNativeManifest } from "../../../../scripts/ci-native-manifest";

const SOURCE_SHA = "0bca45d64934440703556091dc746de41dd5460b";

async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "xcsh-native-manifest-"));
	const nativeDir = path.join(root, "packages/natives/native");
	await mkdir(nativeDir, { recursive: true });
	await writeFile(path.join(nativeDir, "pi_natives.linux-x64-baseline.node"), "baseline");
	await writeFile(path.join(nativeDir, "pi_natives.linux-x64-modern.node"), "modern");
	return root;
}

describe("source-bound native manifest", () => {
	it("records and verifies both Linux x64 variants", async () => {
		const root = await fixture();
		const manifest = await createNativeManifest(root, SOURCE_SHA);
		expect(manifest.source_sha).toBe(SOURCE_SHA);
		expect(manifest.files.map(file => file.path)).toEqual([
			"packages/natives/native/pi_natives.linux-x64-baseline.node",
			"packages/natives/native/pi_natives.linux-x64-modern.node",
		]);
		await expect(verifyNativeManifest(root, manifest, SOURCE_SHA)).resolves.toBeUndefined();
	});

	it("rejects source drift and changed native bytes", async () => {
		const root = await fixture();
		const manifest = await createNativeManifest(root, SOURCE_SHA);
		await expect(verifyNativeManifest(root, manifest, "a".repeat(40))).rejects.toThrow("source SHA");
		await writeFile(path.join(root, manifest.files[0]!.path), "changed");
		await expect(verifyNativeManifest(root, manifest, SOURCE_SHA)).rejects.toThrow("digest");
	});

	it("accepts an explicit frozen-source root for qualification harnesses", async () => {
		const root = await fixture();
		const manifest = await createNativeManifest(root, SOURCE_SHA);
		expect(manifest.files.every(file => file.path.startsWith("packages/natives/native/"))).toBe(true);
	});
});
