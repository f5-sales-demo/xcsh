import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../src/config/settings";
import type { MediaMessage } from "../src/media/types";
import { BlobStore } from "../src/session/blob-store";
import type { ToolSession } from "../src/tools";
import { DisplayImageTool } from "../src/tools/display-image";
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
	expect(result.details?.descriptor.kind).toBe("image");
	expect(result.content).toContainEqual({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
	expect(result.content).toContainEqual({ type: "text", text: "Demo" });
	expect(messages).toHaveLength(1);
	expect(messages[0]!.media.id).toBe(result.details!.descriptor.id);
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

test("display_image delegates ingestion to the durable media core", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-display-image-"));
	roots.push(root);
	const png = Buffer.alloc(24);
	png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	png.writeUInt32BE(3, 16);
	png.writeUInt32BE(2, 20);
	await Bun.write(path.join(root, "compat.bin"), png);
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

	const result = await new DisplayImageTool(session).execute("call", {
		path: "compat.bin",
		caption: "Compatibility",
	});

	expect(messages).toHaveLength(1);
	expect(messages[0]!.media.kind).toBe("image");
	expect(result.content).toContainEqual({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
	expect(result.content).toContainEqual({ type: "text", text: "Compatibility" });
});
