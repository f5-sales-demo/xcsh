import { describe, expect, test } from "bun:test";
import { decodeRasterFrames } from "../src/media/ffmpeg";

const ffmpeg = Bun.which("ffmpeg");

function generateVideo(): Buffer {
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

function generateAnimation(format: "gif" | "webp"): Buffer {
	if (!ffmpeg) throw new Error("ffmpeg unavailable");
	const codec = format === "webp" ? ["-c:v", "libwebp_anim", "-loop", "0"] : [];
	const result = Bun.spawnSync([
		ffmpeg,
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"testsrc=size=24x16:rate=6:duration=0.5",
		"-an",
		...codec,
		"-f",
		format,
		"pipe:1",
	]);
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return Buffer.from(result.stdout);
}

describe.skipIf(!ffmpeg)("decodeRasterFrames", () => {
	test("streams bounded silent PNG frames at the requested FPS cap", async () => {
		const decoded = await decodeRasterFrames(generateVideo(), {
			ffmpegPath: ffmpeg!,
			fpsCap: 4,
			maxFrames: 10,
			maxOutputBytes: 2 * 1024 * 1024,
		});

		expect(decoded).not.toBeNull();
		expect(decoded!.length).toBeGreaterThan(1);
		expect(decoded!.length).toBeLessThanOrEqual(10);
		for (const frame of decoded!) {
			expect(frame.data.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
			expect(frame.durationMs).toBeGreaterThanOrEqual(250);
		}
	});

	test("decodes animated GIF and WebP through the same silent frame pipeline", async () => {
		for (const format of ["gif", "webp"] as const) {
			const decoded = await decodeRasterFrames(generateAnimation(format), {
				ffmpegPath: ffmpeg!,
				fpsCap: 6,
				maxFrames: 10,
			});
			expect(decoded?.length).toBeGreaterThan(1);
		}
	});

	test("rejects corrupt media and output that exceeds the streaming bound", async () => {
		expect(await decodeRasterFrames(Buffer.from("not-media"), { ffmpegPath: ffmpeg! })).toBeNull();
		expect(
			await decodeRasterFrames(generateVideo(), {
				ffmpegPath: ffmpeg!,
				maxOutputBytes: 32,
			}),
		).toBeNull();
	});
});

test("missing FFmpeg degrades without throwing", async () => {
	expect(await decodeRasterFrames(Buffer.from("anything"), { ffmpegPath: "/missing/ffmpeg" })).toBeNull();
});
