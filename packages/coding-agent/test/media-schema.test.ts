import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	createMediaId,
	type MediaMessage,
	sanitizeMediaProvenance,
	validateMediaDescriptorV1,
} from "../src/media/types";
import { convertToLlm } from "../src/session/messages";
import { SessionManager } from "../src/session/session-manager";

describe("MediaDescriptorV1", () => {
	test("validates a muted content-addressed image descriptor", () => {
		const descriptor = validateMediaDescriptorV1({
			version: 1,
			id: createMediaId("a".repeat(64)),
			kind: "image",
			width: 640,
			height: 480,
			alt: "chart",
			original: { ref: `blob:sha256:${"a".repeat(64)}`, mimeType: "image/png", bytes: 24 },
			provenance: { sourceType: "path", source: "/tmp/chart.png" },
			playback: { autoplay: true, loop: false, muted: true, fpsCap: 12 },
		});

		expect(descriptor.id).toBe(`media_${"a".repeat(24)}`);
		expect(descriptor.playback.muted).toBe(true);
	});

	test("rejects non-content-addressed assets and unmuted playback", () => {
		expect(() =>
			validateMediaDescriptorV1({
				version: 1,
				id: "media_bad",
				kind: "video",
				original: { ref: "/tmp/video.mp4", mimeType: "video/mp4", bytes: 10 },
				provenance: { sourceType: "path", source: "/tmp/video.mp4" },
				playback: { autoplay: true, loop: false, muted: false, fpsCap: 12 },
			}),
		).toThrow();
	});

	test("sanitizes URL credentials, query strings, and fragments", () => {
		expect(sanitizeMediaProvenance("https://user:pass@example.com/a.png?token=secret#frag")).toEqual({
			sourceType: "url",
			source: "https://example.com/a.png",
		});
	});
});

test("media messages are omitted from LLM conversion", () => {
	const message: MediaMessage = {
		role: "media",
		media: validateMediaDescriptorV1({
			version: 1,
			id: createMediaId("b".repeat(64)),
			kind: "image",
			original: { ref: `blob:sha256:${"b".repeat(64)}`, mimeType: "image/png", bytes: 24 },
			provenance: { sourceType: "path", source: "/tmp/b.png" },
			playback: { autoplay: false, loop: false, muted: true, fpsCap: 12 },
		}),
		timestamp: 1,
	};

	expect(convertToLlm([message])).toEqual([]);
});

test("media messages and blobs survive a real session reopen", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-media-session-"));
	try {
		const manager = SessionManager.create(root, root);
		const blob = await manager.putBlob(Buffer.from("durable-media"));
		const message: MediaMessage = {
			role: "media",
			timestamp: 42,
			media: validateMediaDescriptorV1({
				version: 1,
				id: createMediaId(blob.hash),
				kind: "image",
				original: { ref: blob.ref, mimeType: "image/png", bytes: 13 },
				provenance: { sourceType: "tool", source: "display_media" },
				playback: { autoplay: true, loop: false, muted: true, fpsCap: 12 },
			}),
		};
		manager.appendMessage(message);
		await manager.ensureOnDisk();
		await manager.flush();
		const reopened = await SessionManager.open(manager.getSessionFile()!);
		const restored = reopened.getBranch().find(entry => entry.type === "message" && entry.message.role === "media");
		expect(restored && restored.type === "message" ? restored.message : undefined).toEqual(message);
		expect(await reopened.getBlobStore().get(blob.hash)).toEqual(Buffer.from("durable-media"));
		expect(convertToLlm([message])).toEqual([]);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
