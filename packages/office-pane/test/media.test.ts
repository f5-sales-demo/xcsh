import { describe, expect, test } from "bun:test";
import { isChatMedia, isMediaAssetChunk, isMediaAssetError } from "../src/core";
import { mediaAssetRefs, type TransportMediaDescriptor, toChatMediaContent } from "../src/panel/media";

const ref = `blob:sha256:${"a".repeat(64)}`;
const descriptor: TransportMediaDescriptor = {
	version: 1,
	id: `media_${"a".repeat(24)}`,
	kind: "raster-timeline",
	original: { ref, mimeType: "image/png", bytes: 3 },
	poster: { ref, mimeType: "image/png", bytes: 3 },
	timeline: [
		{ asset: { ref, mimeType: "image/png", bytes: 3 }, durationMs: 100 },
		{ text: "done", durationMs: 200 },
	],
	provenance: { sourceType: "tool", source: "display_media" },
	playback: { autoplay: true, loop: false, muted: true, fpsCap: 12 },
};

describe("Office media projection", () => {
	test("deduplicates assets and maps raster/text frames to browser URLs", () => {
		expect(mediaAssetRefs(descriptor)).toEqual([ref]);
		const projected = toChatMediaContent(descriptor, new Map([[ref, "blob:test"]]));
		expect(projected.src).toBe("blob:test");
		expect(projected.posterSrc).toBe("blob:test");
		expect(projected.frames).toEqual([
			{ src: "blob:test", durationMs: 100 },
			{ text: "done", durationMs: 200 },
		]);
		expect(projected.playback.muted).toBe(true);
	});

	test("narrows media event and chunk contracts", () => {
		expect(isChatMedia({ type: "chat_media", id: "c-1", media: descriptor })).toBe(true);
		expect(
			isMediaAssetChunk({
				type: "media_asset_chunk",
				requestId: "r-1",
				chunk: {
					ref,
					mimeType: "image/png",
					offset: 0,
					nextOffset: 3,
					eof: true,
					bytes: 3,
					data: "aW1n",
				},
			}),
		).toBe(true);
		expect(isMediaAssetError({ type: "media_asset_error", requestId: "r-1", error: "asset-unavailable" })).toBe(true);
	});
});
