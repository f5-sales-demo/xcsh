import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { listMediaAssets, projectMediaDescriptorForTransport, readMediaAssetChunk } from "../src/media/transport";
import type { MediaDescriptorV1 } from "../src/media/types";
import { BlobStore } from "../src/session/blob-store";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

function descriptor(ref: string, bytes: number): MediaDescriptorV1 {
	return {
		version: 1,
		id: `media_${"a".repeat(24)}`,
		kind: "image",
		original: { ref, mimeType: "image/png", bytes },
		poster: { ref, mimeType: "image/png", bytes },
		provenance: { sourceType: "path", source: "/home/robin/private/chart.png" },
		playback: { autoplay: true, loop: false, muted: true, fpsCap: 12 },
	};
}

describe("media transport projection", () => {
	test("preserves the canonical descriptor while removing local provenance", () => {
		const projected = projectMediaDescriptorForTransport(descriptor(`blob:sha256:${"a".repeat(64)}`, 6));
		expect(projected.provenance).toEqual({ sourceType: "tool", source: "display_media" });
		expect(JSON.stringify(projected)).not.toContain("/home/robin");
		expect(projected.playback.muted).toBe(true);
	});

	test("sanitizes HTTPS provenance again before transport", () => {
		const value = descriptor(`blob:sha256:${"a".repeat(64)}`, 6);
		value.provenance = { sourceType: "url", source: "https://user:secret@example.com/image.png?token=x#part" };
		expect(projectMediaDescriptorForTransport(value).provenance).toEqual({
			sourceType: "url",
			source: "https://example.com/image.png",
		});
	});

	test("replaces malformed URL provenance instead of leaking it", () => {
		const value = descriptor(`blob:sha256:${"a".repeat(64)}`, 6);
		value.provenance = { sourceType: "url", source: "/home/robin/not-really-a-url" };
		expect(projectMediaDescriptorForTransport(value).provenance).toEqual({
			sourceType: "tool",
			source: "display_media",
		});
	});

	test("deduplicates original, poster, and timeline assets", () => {
		const value = descriptor(`blob:sha256:${"a".repeat(64)}`, 6);
		value.kind = "raster-timeline";
		value.timeline = [{ asset: value.original!, durationMs: 100 }];
		expect(listMediaAssets(value)).toEqual([value.original!]);
	});
});

describe("media asset chunks", () => {
	test("returns bounded deterministic chunks and EOF", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-media-transport-"));
		roots.push(root);
		const store = new BlobStore(root);
		const put = await store.put(Buffer.from("abcdef"));
		const value = descriptor(put.ref, 6);

		const first = await readMediaAssetChunk(store, [value], { ref: put.ref, offset: 1, length: 3 });
		expect(first).toEqual({
			ref: put.ref,
			mimeType: "image/png",
			offset: 1,
			nextOffset: 4,
			eof: false,
			bytes: 3,
			data: Buffer.from("bcd").toString("base64"),
		});
		const second = await readMediaAssetChunk(store, [value], { ref: put.ref, offset: 4, length: 99 });
		expect(second.eof).toBe(true);
		expect(second.nextOffset).toBe(6);
	});

	test("caps a requested chunk at the transport maximum", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-media-transport-"));
		roots.push(root);
		const store = new BlobStore(root);
		const bytes = Buffer.alloc(300_000, 1);
		const put = await store.put(bytes);
		const chunk = await readMediaAssetChunk(store, [descriptor(put.ref, bytes.length)], {
			ref: put.ref,
			length: 1_000_000,
		});
		expect(chunk.bytes).toBe(256 * 1024);
		expect(chunk.nextOffset).toBe(256 * 1024);
		expect(chunk.eof).toBe(false);
	});

	test("rejects unknown refs, invalid offsets, and descriptor/blob size mismatch", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-media-transport-"));
		roots.push(root);
		const store = new BlobStore(root);
		const put = await store.put(Buffer.from("abcdef"));
		const value = descriptor(put.ref, 7);
		await expect(readMediaAssetChunk(store, [value], { ref: `blob:sha256:${"b".repeat(64)}` })).rejects.toThrow(
			"unknown media asset",
		);
		await expect(readMediaAssetChunk(store, [value], { ref: put.ref, offset: -1 })).rejects.toThrow("offset");
		await expect(readMediaAssetChunk(store, [value], { ref: put.ref })).rejects.toThrow("size mismatch");
	});
});
