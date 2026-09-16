import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadReferenceBaseline,
	validateReferenceBaseline,
	verifyArtifactHash,
} from "../../scripts/remote-reference/baseline";

test("both explicit Codex reference baselines are complete and pinned", async () => {
	const oldBaseline = await loadReferenceBaseline("0.153.4");
	const current = await loadReferenceBaseline("0.154.0");
	expect(oldBaseline).toMatchObject({
		tag: "rust-v0.153.4",
		sourceCommit: "3d2ee51ca2d5db578f328aa75e20aa22c0197c9a",
	});
	expect(current).toMatchObject({
		tag: "rust-v0.154.0",
		sourceCommit: "6b9826e3aa83b1a5947db50f4332cb9c65f1b340",
	});
	expect(Object.keys(current.files)).toContain("codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs");
	await expect(loadReferenceBaseline("latest")).rejects.toThrow("Explicit reference baseline");
});

test("malformed manifests and mismatched artifact hashes fail closed", async () => {
	expect(() => validateReferenceBaseline({ version: "0.154.0", files: {} }, "0.154.0")).toThrow(
		"malformed or incomplete",
	);
	const root = await mkdtemp(join(tmpdir(), "xcsh-reference-baseline-"));
	try {
		const artifact = join(root, "codex");
		await writeFile(artifact, "fixture");
		const hash = createHash("sha256").update("fixture").digest("hex");
		expect(await verifyArtifactHash(artifact, hash)).toBe(hash);
		await expect(verifyArtifactHash(artifact, "0".repeat(64))).rejects.toThrow("differs");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
