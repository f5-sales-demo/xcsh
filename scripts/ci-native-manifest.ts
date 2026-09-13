#!/usr/bin/env bun

import * as path from "node:path";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const EXPECTED_FILES = [
	"packages/natives/native/pi_natives.linux-x64-baseline.node",
	"packages/natives/native/pi_natives.linux-x64-modern.node",
] as const;

export interface NativeManifestFile {
	path: string;
	sha256: string;
	size: number;
}

export interface NativeManifest {
	schema_version: 1;
	source_sha: string;
	files: NativeManifestFile[];
}

function assertSourceSha(sourceSha: string): void {
	if (!SHA_PATTERN.test(sourceSha)) throw new Error(`invalid source SHA: ${JSON.stringify(sourceSha)}`);
}

async function fileRecord(root: string, relativePath: string): Promise<NativeManifestFile> {
	const file = Bun.file(path.join(root, relativePath));
	if (!(await file.exists())) throw new Error(`missing native artifact: ${relativePath}`);
	const bytes = await file.arrayBuffer();
	const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
	return { path: relativePath, sha256, size: bytes.byteLength };
}

export async function createNativeManifest(root: string, sourceSha: string): Promise<NativeManifest> {
	assertSourceSha(sourceSha);
	return {
		schema_version: 1,
		source_sha: sourceSha,
		files: await Promise.all(EXPECTED_FILES.map(relativePath => fileRecord(root, relativePath))),
	};
}

export async function verifyNativeManifest(root: string, manifest: NativeManifest, sourceSha: string): Promise<void> {
	assertSourceSha(sourceSha);
	if (manifest.schema_version !== 1) throw new Error(`unsupported native manifest schema: ${manifest.schema_version}`);
	if (manifest.source_sha !== sourceSha) {
		throw new Error(`native manifest source SHA ${manifest.source_sha} does not match ${sourceSha}`);
	}
	if (JSON.stringify(manifest.files.map(file => file.path)) !== JSON.stringify(EXPECTED_FILES)) {
		throw new Error("native manifest does not contain exactly the baseline and modern Linux x64 artifacts");
	}
	for (const expected of manifest.files) {
		const actual = await fileRecord(root, expected.path);
		if (actual.sha256 !== expected.sha256) throw new Error(`native artifact digest mismatch: ${expected.path}`);
		if (actual.size !== expected.size) throw new Error(`native artifact size mismatch: ${expected.path}`);
	}
}

function option(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index < 0 ? undefined : process.argv[index + 1];
}

if (import.meta.main) {
	const command = process.argv[2];
	const sourceSha = option("--source-sha");
	const manifestPath = option("--manifest") ?? "packages/natives/native/native-manifest.json";
	const root = option("--root") ?? path.join(import.meta.dir, "..");
	if ((command !== "create" && command !== "verify") || !sourceSha) {
		console.error(
			"usage: ci-native-manifest.ts <create|verify> --source-sha <sha> [--manifest <path>] [--root <path>]",
		);
		process.exit(2);
	}
	if (command === "create") {
		const manifest = await createNativeManifest(root, sourceSha);
		await Bun.write(path.join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
	} else {
		const manifest = (await Bun.file(path.join(root, manifestPath)).json()) as NativeManifest;
		await verifyNativeManifest(root, manifest, sourceSha);
	}
}
