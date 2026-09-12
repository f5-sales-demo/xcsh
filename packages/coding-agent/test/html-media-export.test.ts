import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { exportSessionToHtml, prepareSessionHtmlExport } from "../src/export/html";
import { createMediaId, type MediaMessage } from "../src/media/types";
import { SessionManager } from "../src/session/session-manager";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

test("HTML export copies content-addressed media and emits native playback renderers", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-html-media-"));
	roots.push(root);
	const sm = SessionManager.create(root, root);
	const bytes = Buffer.from("video-data");
	const blob = await sm.putBlob(bytes);
	const message: MediaMessage = {
		role: "media",
		timestamp: 1,
		media: {
			version: 1,
			id: createMediaId(blob.hash),
			kind: "video",
			original: { ref: blob.ref, mimeType: "video/mp4", bytes: bytes.length },
			caption: "Demo clip",
			provenance: { sourceType: "path", source: "/home/<user>/private/demo.mp4" },
			playback: { autoplay: true, loop: false, muted: true, fpsCap: 12 },
		},
	};
	sm.appendMessage(message);
	await sm.ensureOnDisk();
	await sm.flush();

	const output = path.join(root, "share.html");
	const prepared = await prepareSessionHtmlExport(sm, undefined, { outputPath: output });
	expect(await Bun.file(output).exists()).toBe(false);
	expect(await fs.readdir(root)).not.toContain("share-media");
	expect(prepared.outputPath).toBe(output);
	expect(prepared.files.map(file => file.path)).toEqual([path.join(root, "share-media", `${blob.hash}.mp4`), output]);
	expect(Buffer.from(prepared.files[0].bytes)).toEqual(bytes);
	expect(prepared.missingAssets).toBe(0);
	await exportSessionToHtml(sm, undefined, { outputPath: output });
	const mediaPath = path.join(root, "share-media", `${blob.hash}.mp4`);
	expect(Buffer.from(await fs.readFile(mediaPath))).toEqual(bytes);

	const html = await fs.readFile(output, "utf8");
	expect(html).toContain("<video");
	expect(html).toContain("prefers-reduced-motion");
	const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
	expect(encoded).toBeDefined();
	const data = JSON.parse(Buffer.from(encoded!, "base64").toString("utf8"));
	expect(data.mediaAssets[blob.ref]).toBe(`share-media/${blob.hash}.mp4`);
	expect(JSON.stringify(data)).not.toContain("/home/<user>/private");
});

test("HTML export records a missing media asset without failing", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-html-media-"));
	roots.push(root);
	const sm = SessionManager.create(root, root);
	const hash = "a".repeat(64);
	sm.appendMessage({
		role: "media",
		timestamp: 1,
		media: {
			version: 1,
			id: createMediaId(hash),
			kind: "image",
			original: { ref: `blob:sha256:${hash}`, mimeType: "image/png", bytes: 10 },
			provenance: { sourceType: "tool", source: "display_media" },
			playback: { autoplay: false, loop: false, muted: true, fpsCap: 12 },
		},
	});
	await sm.ensureOnDisk();
	const output = path.join(root, "missing.html");
	const prepared = await prepareSessionHtmlExport(sm, undefined, { outputPath: output });
	expect(prepared.missingAssets).toBe(1);
	expect(prepared.files).toHaveLength(1);
	expect(await Bun.file(output).exists()).toBe(false);
	await expect(exportSessionToHtml(sm, undefined, { outputPath: output })).resolves.toBe(output);
	const html = await fs.readFile(output, "utf8");
	const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
	const data = JSON.parse(Buffer.from(encoded!, "base64").toString("utf8"));
	expect(data.mediaAssets[`blob:sha256:${hash}`]).toBeNull();
});
