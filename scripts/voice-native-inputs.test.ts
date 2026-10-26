import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { voiceInputBytes } from "./voice-native-inputs";

const bytes = new TextEncoder().encode("fixture exact source archive");
const digest = createHash("sha256").update(bytes).digest("hex");
test("prepared native input uses exact bytes without another network fetch", async () => {
	const root = await mkdtemp(join(tmpdir(), "voice-input-"));
	try {
		const file = join(root, "archive.tar");
		await writeFile(file, bytes);
		const fetcher = async () => {
			throw new Error("Prepared input must not fetch");
		};
		expect(await voiceInputBytes("fixture", "https://fixture.invalid/", digest, file, fetcher)).toEqual(bytes);
		await expect(
			voiceInputBytes("fixture", "https://fixture.invalid/", "0".repeat(64), file, fetcher),
		).rejects.toThrow("hash mismatch");
		await symlink(file, join(root, "link.tar"));
		await expect(
			voiceInputBytes("fixture", "https://fixture.invalid/", digest, join(root, "link.tar"), fetcher),
		).rejects.toThrow("Invalid native input");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("native input HTTP status is retained without exposing a response body", async () => {
	await expect(
		voiceInputBytes(
			"fixture",
			"https://fixture.invalid/",
			digest,
			undefined,
			async () => new Response("private fixture body", { status: 503 }),
		),
	).rejects.toThrow("fixture (HTTP 503)");
});
test("network input still verifies the pinned digest", async () => {
	expect(
		await voiceInputBytes("fixture", "https://fixture.invalid/", digest, undefined, async () => new Response(bytes)),
	).toEqual(bytes);
	await expect(
		voiceInputBytes("fixture", "https://fixture.invalid/", digest, undefined, async () => new Response("wrong")),
	).rejects.toThrow("hash mismatch");
});
