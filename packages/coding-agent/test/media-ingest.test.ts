import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MediaIngestError, MediaIngestor } from "../src/media/ingest";
import { isProhibitedMediaAddress } from "../src/media/network";
import { BlobStore, parseBlobRef } from "../src/session/blob-store";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; store: BlobStore }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-media-"));
	roots.push(root);
	return { root, store: new BlobStore(path.join(root, "blobs")) };
}

function png(width = 2, height = 3): Buffer {
	const value = Buffer.alloc(24);
	value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	value.writeUInt32BE(width, 16);
	value.writeUInt32BE(height, 20);
	return value;
}

describe("MediaIngestor", () => {
	test("sniffs, content-addresses, and deduplicates local media", async () => {
		const { root, store } = await fixture();
		await Bun.write(path.join(root, "not-an-image.bin"), png());
		const ingestor = new MediaIngestor({ cwd: root, blobStore: store });

		const first = await ingestor.ingest({ source: "not-an-image.bin", alt: "tiny image" });
		const second = await ingestor.ingest({ source: "not-an-image.bin" });

		expect(first.descriptor.kind).toBe("image");
		expect(first.descriptor.width).toBe(2);
		expect(first.descriptor.height).toBe(3);
		expect(first.descriptor.original?.ref).toBe(second.descriptor.original?.ref);
		expect(first.descriptor.poster?.ref).toBe(first.descriptor.original?.ref);
		expect(first.posterData).toBe(png().toString("base64"));
		const hash = parseBlobRef(first.descriptor.original?.ref ?? "");
		expect(hash && (await store.has(hash))).toBe(true);
	});

	test("enforces the configured byte limit before ingestion", async () => {
		const { root, store } = await fixture();
		await Bun.write(path.join(root, "oversized.png"), Buffer.concat([png(), Buffer.alloc(20)]));
		const ingestor = new MediaIngestor({ cwd: root, blobStore: store, maxBytes: 32 });
		await expect(ingestor.ingest({ source: "oversized.png" })).rejects.toBeInstanceOf(MediaIngestError);
	});

	test("bounds raster timelines by aggregate bytes", async () => {
		const { root, store } = await fixture();
		await Bun.write(path.join(root, "one.png"), png());
		await Bun.write(path.join(root, "two.png"), png());
		const ingestor = new MediaIngestor({ cwd: root, blobStore: store, maxBytes: 32 });
		await expect(
			ingestor.ingest({
				frames: [
					{ source: "one.png", durationMs: 100 },
					{ source: "two.png", durationMs: 100 },
				],
			}),
		).rejects.toThrow("aggregate");
	});

	test("creates ordered text timelines with bounded playback defaults", async () => {
		const { root, store } = await fixture();
		const ingestor = new MediaIngestor({ cwd: root, blobStore: store });
		const result = await ingestor.ingest({
			frames: [
				{ text: "one", durationMs: 40 },
				{ text: "two", durationMs: 60 },
			],
			loop: true,
			fpsCap: 120,
		});
		expect(result.descriptor.kind).toBe("text-timeline");
		expect(result.descriptor.durationMs).toBe(100);
		expect(result.descriptor.timeline).toHaveLength(2);
		expect(result.descriptor.playback).toEqual({ autoplay: true, loop: true, muted: true, fpsCap: 60 });
	});
});

describe("remote media address policy", () => {
	test("permits public, RFC1918, and IPv6 ULA addresses", () => {
		for (const address of ["8.8.8.8", "10.1.2.3", "172.16.1.2", "192.168.1.2", "fc00::1", "fd12::1"]) {
			expect(isProhibitedMediaAddress(address)).toBe(false);
		}
	});

	test("rejects loopback, link-local, metadata, multicast, and unspecified addresses", () => {
		for (const address of [
			"0.0.0.0",
			"127.0.0.1",
			"169.254.169.254",
			"224.0.0.1",
			"::",
			"::1",
			"fe80::1",
			"ff02::1",
		]) {
			expect(isProhibitedMediaAddress(address)).toBe(true);
		}
	});
});

const ffmpeg = Bun.which("ffmpeg");

function generatedMp4(): Buffer {
	if (!ffmpeg) throw new Error("ffmpeg unavailable");
	const result = Bun.spawnSync([
		ffmpeg,
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"testsrc=size=24x16:rate=6:duration=0.5",
		"-an",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"frag_keyframe+empty_moov",
		"-f",
		"mp4",
		"pipe:1",
	]);
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return Buffer.from(result.stdout);
}

describe.skipIf(!ffmpeg)("FFmpeg media ingestion", () => {
	test("stores bounded decoded video frames as a canonical raster timeline", async () => {
		const { root, store } = await fixture();
		await Bun.write(path.join(root, "clip.bin"), generatedMp4());
		const result = await new MediaIngestor({
			cwd: root,
			blobStore: store,
			ffmpegPath: ffmpeg!,
			ffprobePath: Bun.which("ffprobe") ?? "ffprobe",
		}).ingest({ source: "clip.bin", fpsCap: 4 });

		expect(result.descriptor.kind).toBe("video");
		expect(result.descriptor.timeline?.length).toBeGreaterThan(1);
		expect(result.descriptor.playback.fpsCap).toBe(4);
		expect(result.descriptor.poster?.ref).toBe(
			result.descriptor.timeline?.[0] && "asset" in result.descriptor.timeline[0]
				? result.descriptor.timeline[0].asset.ref
				: undefined,
		);
		for (const frame of result.descriptor.timeline ?? []) {
			expect("asset" in frame).toBe(true);
			if ("asset" in frame) {
				const hash = parseBlobRef(frame.asset.ref);
				expect(hash && (await store.has(hash))).toBe(true);
			}
		}
	});

	test("keeps the original and records a static degradation when FFmpeg is missing", async () => {
		const { root, store } = await fixture();
		await Bun.write(path.join(root, "clip.mp4"), generatedMp4());
		const result = await new MediaIngestor({
			cwd: root,
			blobStore: store,
			ffmpegPath: "/missing/ffmpeg",
			ffprobePath: "/missing/ffprobe",
		}).ingest({ source: "clip.mp4" });

		expect(result.descriptor.original).toBeDefined();
		expect(result.descriptor.timeline).toBeUndefined();
		expect(result.descriptor.degradation).toContain("FFmpeg 6+");
	});
});

test("rejects an HTTPS response whose declared MIME disagrees with sniffed content", async () => {
	const { root, store } = await fixture();
	const ingestor = new MediaIngestor({
		cwd: root,
		blobStore: store,
		downloadMedia: async source => ({
			data: png(),
			contentType: "video/mp4",
			finalUrl: source,
		}),
	});
	await expect(ingestor.ingest({ source: "https://media.example/chart.png?token=secret" })).rejects.toThrow(
		"MIME mismatch",
	);
});
