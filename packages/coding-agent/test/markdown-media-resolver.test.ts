import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createMarkdownMediaOptions } from "../src/media/markdown-resolver";
import { createMediaId, type MediaMessage, validateMediaDescriptorV1 } from "../src/media/types";
import { BlobStore } from "../src/session/blob-store";
import type { SessionManager } from "../src/session/session-manager";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

test("Markdown media recovers a persisted descriptor without reading its original source", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-markdown-media-"));
	roots.push(root);
	const store = new BlobStore(path.join(root, "blobs"));
	const png = Buffer.alloc(24);
	png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	png.writeUInt32BE(8, 16);
	png.writeUInt32BE(9, 20);
	const stored = await store.put(png);
	const media: MediaMessage = {
		role: "media",
		media: validateMediaDescriptorV1({
			version: 1,
			id: createMediaId(stored.hash),
			kind: "image",
			width: 8,
			height: 9,
			original: { ref: stored.ref, mimeType: "image/png", bytes: png.byteLength },
			poster: { ref: stored.ref, mimeType: "image/png", bytes: png.byteLength },
			provenance: { sourceType: "path", source: path.join(root, "deleted.png") },
			playback: { autoplay: true, loop: false, muted: true, fpsCap: 12 },
		}),
		timestamp: 1,
	};
	let appended = 0;
	const manager = {
		getEntries: () => [
			{ type: "message", id: "1", parentId: null, timestamp: new Date(1).toISOString(), message: media },
		],
		getBlobStore: () => store,
		getCwd: () => root,
		getArtifactPath: async () => null,
		appendMessage: () => {
			appended++;
			return "2";
		},
	} as unknown as SessionManager;
	const options = createMarkdownMediaOptions(manager, () => {});

	const resolved = await options.resolve({ source: path.join(root, "deleted.png"), alt: "restored" });
	expect(resolved.data).toBe(png.toString("base64"));
	expect(resolved.filename).toBe("restored");
	expect(appended).toBe(0);
});
