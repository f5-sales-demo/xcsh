import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { CorpusSource } from "../../scripts/corpus-sources";
import { downloadVerifiedCorpusAsset } from "../../scripts/verified-corpus-asset";

const payload = new TextEncoder().encode("verified bytes");
const source: CorpusSource = {
	repository: "f5-sales-demo/html-to-markdown",
	tag: "content-20260101T000000Z",
	commit: "a".repeat(40),
	acceptance: "immutable",
	assets: {
		"manifest.json": { sha256: createHash("sha256").update(payload).digest("hex"), size_bytes: payload.length },
	},
};
test("verified streamed bytes match the resolved immutable asset identity", async () => {
	const bytes = await downloadVerifiedCorpusAsset(source, "manifest.json", async () => new Response(payload));
	expect(bytes).toEqual(payload);
});
test("oversized stream is rejected before retaining bytes outside the declared asset", async () => {
	const data = new Uint8Array(payload.length + 1);
	await expect(downloadVerifiedCorpusAsset(source, "manifest.json", async () => new Response(data))).rejects.toThrow(
		"bytes mismatch",
	);
});
test("partial and forged payloads fail integrity verification", async () => {
	await expect(
		downloadVerifiedCorpusAsset(source, "manifest.json", async () => new Response(payload.slice(1))),
	).rejects.toThrow("bytes mismatch");
	await expect(
		downloadVerifiedCorpusAsset(source, "manifest.json", async () => new Response(new Uint8Array(payload.length))),
	).rejects.toThrow("bytes mismatch");
});
test("missing assets and service failures are not successful preparation", async () => {
	await expect(downloadVerifiedCorpusAsset(source, "missing.json", async () => new Response(payload))).rejects.toThrow(
		"Missing published",
	);
	await expect(
		downloadVerifiedCorpusAsset(source, "manifest.json", async () => new Response("", { status: 503 })),
	).rejects.toThrow("HTTP 503");
});
test("unsafe asset names cannot alter the download endpoint", async () => {
	let calls = 0;
	await expect(
		downloadVerifiedCorpusAsset(source, "../manifest.json", async () => {
			calls++;
			return new Response(payload);
		}),
	).rejects.toThrow("asset name");
	expect(calls).toBe(0);
});
