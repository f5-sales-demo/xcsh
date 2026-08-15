import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../src/config/settings";
import type { MediaMessage } from "../src/media/types";
import { BlobStore } from "../src/session/blob-store";
import type { ToolSession } from "../src/tools";
import { DisplayMediaTool } from "../src/tools/display-media";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

test("display_media ingests a source, returns a poster, and persists a media message", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-display-media-"));
	roots.push(root);
	const png = Buffer.alloc(24);
	png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	png.writeUInt32BE(4, 16);
	png.writeUInt32BE(5, 20);
	await Bun.write(path.join(root, "poster.dat"), png);
	const messages: MediaMessage[] = [];
	const session = {
		cwd: root,
		hasUI: true,
		settings: Settings.isolated({}),
		getSessionFile: () => null,
		getSessionSpawns: () => null,
		mediaBlobStore: new BlobStore(path.join(root, "blobs")),
		appendMediaMessage: message => messages.push(message),
	} as ToolSession;
	const tool = new DisplayMediaTool(session);
	const result = await tool.execute("call", { source: "poster.dat", caption: "Demo" });

	expect(tool.name).toBe("display_media");
	expect(result.details?.mediaResult).toBe("xcsh.media/v1");
	expect(result.details?.descriptor.kind).toBe("image");
	expect(result.content).toContainEqual({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
	expect(result.content).toContainEqual({ type: "text", text: "Demo" });
	expect(messages).toHaveLength(1);
	expect(messages[0]!.media.id).toBe(result.details!.descriptor.id);
});

test("generated buffers use the same durable publication service", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-generated-media-"));
	roots.push(root);
	const png = Buffer.alloc(24);
	png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	png.writeUInt32BE(8, 16);
	png.writeUInt32BE(6, 20);
	const store = new BlobStore(path.join(root, "blobs"));
	const { MediaIngestor } = await import("../src/media/ingest");
	const ingested = await new MediaIngestor({ cwd: root, blobStore: store }).ingestBuffer({
		data: png,
		mimeType: "image/png",
		width: 8,
		height: 6,
		filenameHint: "map.png",
		metadata: { producer: "render_map" },
		provenance: { sourceType: "tool", source: "render_map" },
	});
	expect(ingested.descriptor.filenameHint).toBe("map.png");
	expect(ingested.descriptor.metadata).toEqual({ producer: "render_map" });
	expect(await store.get(ingested.descriptor.original!.ref.slice("blob:sha256:".length))).toEqual(png);
});

describe("display_media validation", () => {
	test("rejects source and frames together", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-display-media-"));
		roots.push(root);
		const session = {
			cwd: root,
			hasUI: false,
			settings: Settings.isolated({}),
			getSessionFile: () => null,
			getSessionSpawns: () => null,
			mediaBlobStore: new BlobStore(path.join(root, "blobs")),
		} as ToolSession;
		const tool = new DisplayMediaTool(session);
		await expect(tool.execute("call", { source: "x.png", frames: [{ text: "x", durationMs: 100 }] })).rejects.toThrow(
			"either source or frames",
		);
	});
});
