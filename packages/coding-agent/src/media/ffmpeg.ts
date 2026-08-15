import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface ProbedMedia {
	width?: number;
	height?: number;
	durationMs?: number;
}

export interface DecodedRasterFrame {
	data: Buffer;
	durationMs: number;
}

export interface DecodeRasterFramesOptions {
	ffmpegPath?: string;
	fpsCap?: number;
	maxFrames?: number;
	maxOutputBytes?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
	webpmuxPath?: string;
	animDumpPath?: string;
}

async function runWithInput(
	command: string[],
	input: Buffer,
	timeoutMs: number,
	maxOutputBytes: number,
	signal?: AbortSignal,
): Promise<Buffer> {
	const child = Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	let timedOut = false;
	let aborted = false;
	const onAbort = () => {
		aborted = true;
		child.kill();
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	if (signal?.aborted) onAbort();
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, timeoutMs);
	const stderrPromise = new Response(child.stderr).text();
	const chunks: Buffer[] = [];
	let bytes = 0;
	try {
		child.stdin.write(input);
		child.stdin.end();
		const reader = child.stdout.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = Buffer.from(value);
			bytes += chunk.byteLength;
			if (bytes > maxOutputBytes) {
				child.kill();
				throw new Error("decoded media output exceeded its bound");
			}
			chunks.push(chunk);
		}
		const exitCode = await child.exited;
		const stderr = await stderrPromise;
		if (aborted) throw signal?.reason ?? new Error("media decoder aborted");
		if (timedOut) throw new Error("media decoder timed out");
		if (exitCode !== 0) throw new Error(stderr.trim() || `${command[0]} exited with code ${exitCode}`);
		return Buffer.concat(chunks, bytes);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}

async function runWithoutInput(
	command: string[],
	timeoutMs: number,
	maxOutputBytes: number,
	signal?: AbortSignal,
): Promise<Buffer> {
	const child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	let timedOut = false;
	let aborted = false;
	const onAbort = () => {
		aborted = true;
		child.kill();
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	if (signal?.aborted) onAbort();
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, timeoutMs);
	const stderrPromise = new Response(child.stderr).text();
	const chunks: Buffer[] = [];
	let bytes = 0;
	try {
		const reader = child.stdout.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = Buffer.from(value);
			bytes += chunk.byteLength;
			if (bytes > maxOutputBytes) {
				child.kill();
				throw new Error("media helper output exceeded its bound");
			}
			chunks.push(chunk);
		}
		const exitCode = await child.exited;
		const stderr = await stderrPromise;
		if (aborted) throw signal?.reason ?? new Error("media helper aborted");
		if (timedOut) throw new Error("media helper timed out");
		if (exitCode !== 0) throw new Error(stderr.trim() || `${command[0]} exited with code ${exitCode}`);
		return Buffer.concat(chunks, bytes);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}

function isAnimatedWebp(input: Buffer): boolean {
	return (
		input.length >= 16 &&
		input.subarray(0, 4).toString("ascii") === "RIFF" &&
		input.subarray(8, 12).toString("ascii") === "WEBP" &&
		input.includes(Buffer.from("ANIM"))
	);
}

async function decodeAnimatedWebpFallback(
	input: Buffer,
	options: {
		ffmpegPath: string;
		webpmuxPath: string;
		animDumpPath: string;
		maxFrames: number;
		maxOutputBytes: number;
		timeoutMs: number;
		fpsCap: number;
		signal?: AbortSignal;
	},
): Promise<DecodedRasterFrame[] | null> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-webp-"));
	try {
		const sourcePath = path.join(directory, "input.webp");
		const framesPath = path.join(directory, "frames");
		await fs.mkdir(framesPath);
		await fs.writeFile(sourcePath, input);
		const info = (
			await runWithoutInput(
				[options.webpmuxPath, "-info", sourcePath],
				options.timeoutMs,
				1024 * 1024,
				options.signal,
			)
		).toString("utf8");
		const canvas = /Canvas size:\s*(\d+)\s*x\s*(\d+)/u.exec(info);
		const count = /Number of frames:\s*(\d+)/u.exec(info);
		const width = Number(canvas?.[1]);
		const height = Number(canvas?.[2]);
		const frameCount = Number(count?.[1]);
		if (
			!Number.isInteger(width) ||
			!Number.isInteger(height) ||
			!Number.isInteger(frameCount) ||
			width <= 0 ||
			height <= 0 ||
			frameCount <= 0 ||
			frameCount > options.maxFrames ||
			width * height * 4 * frameCount > options.maxOutputBytes
		) {
			return null;
		}
		const nativeDurations = info
			.split("\n")
			.map(line => /^\s*\d+:\s+\d+\s+\d+\s+\S+\s+\d+\s+\d+\s+(\d+)/u.exec(line))
			.filter((match): match is RegExpExecArray => match !== null)
			.map(match => Number(match[1]));
		await runWithoutInput(
			[options.animDumpPath, "-folder", framesPath, "-prefix", "frame_", "-pam", sourcePath],
			options.timeoutMs,
			1024 * 1024,
			options.signal,
		);
		const framePaths = (await fs.readdir(framesPath))
			.filter(name => /^frame_\d+\.pam$/u.test(name))
			.sort(
				(left, right) =>
					Number(left.slice("frame_".length, -".pam".length)) -
					Number(right.slice("frame_".length, -".pam".length)),
			)
			.slice(0, options.maxFrames);
		if (framePaths.length !== frameCount) return null;
		const frames: DecodedRasterFrame[] = [];
		let outputBytes = 0;
		const minimumDuration = Math.ceil(1000 / options.fpsCap);
		for (const [index, name] of framePaths.entries()) {
			const pam = await fs.readFile(path.join(framesPath, name));
			const remaining = options.maxOutputBytes - outputBytes;
			if (remaining <= 0) return null;
			const png = await runWithInput(
				[
					options.ffmpegPath,
					"-v",
					"error",
					"-nostdin",
					"-f",
					"image2pipe",
					"-vcodec",
					"pam",
					"-i",
					"pipe:0",
					"-frames:v",
					"1",
					"-f",
					"image2pipe",
					"-vcodec",
					"png",
					"pipe:1",
				],
				pam,
				options.timeoutMs,
				remaining,
				options.signal,
			);
			outputBytes += png.byteLength;
			frames.push({ data: png, durationMs: Math.max(minimumDuration, nativeDurations[index] ?? minimumDuration) });
		}
		return frames;
	} catch {
		return null;
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}

function splitPngStream(output: Buffer, maxFrames: number): Buffer[] {
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const frames: Buffer[] = [];
	let offset = 0;
	while (offset < output.length) {
		if (!output.subarray(offset, offset + signature.length).equals(signature)) {
			throw new Error("FFmpeg emitted an invalid PNG stream");
		}
		const start = offset;
		offset += signature.length;
		let complete = false;
		while (offset + 12 <= output.length) {
			const length = output.readUInt32BE(offset);
			const chunkEnd = offset + 12 + length;
			if (chunkEnd > output.length) throw new Error("FFmpeg emitted a truncated PNG frame");
			const type = output.subarray(offset + 4, offset + 8).toString("ascii");
			offset = chunkEnd;
			if (type === "IEND") {
				frames.push(output.subarray(start, offset));
				if (frames.length > maxFrames) throw new Error("decoded media exceeded its frame bound");
				complete = true;
				break;
			}
		}
		if (!complete) throw new Error("FFmpeg emitted an incomplete PNG frame");
	}
	return frames;
}

export async function probeMedia(
	input: Buffer,
	ffprobePath = "ffprobe",
	timeoutMs = 10_000,
	signal?: AbortSignal,
): Promise<ProbedMedia | null> {
	try {
		const output = await runWithInput(
			[
				ffprobePath,
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=width,height:format=duration",
				"-of",
				"json",
				"-i",
				"pipe:0",
			],
			input,
			timeoutMs,
			1024 * 1024,
			signal,
		);
		const parsed = JSON.parse(output.toString("utf8")) as {
			streams?: Array<{ width?: number; height?: number }>;
			format?: { duration?: string };
		};
		const stream = parsed.streams?.[0];
		const durationSeconds = Number(parsed.format?.duration);
		return {
			width: stream?.width,
			height: stream?.height,
			durationMs:
				Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : undefined,
		};
	} catch {
		return null;
	}
}

export async function decodePoster(
	input: Buffer,
	ffmpegPath = "ffmpeg",
	timeoutMs = 15_000,
	signal?: AbortSignal,
): Promise<Buffer | null> {
	try {
		return await runWithInput(
			[
				ffmpegPath,
				"-v",
				"error",
				"-nostdin",
				"-i",
				"pipe:0",
				"-an",
				"-frames:v",
				"1",
				"-vf",
				"scale='min(1920,iw)':-2",
				"-f",
				"image2pipe",
				"-vcodec",
				"png",
				"pipe:1",
			],
			input,
			timeoutMs,
			25 * 1024 * 1024,
			signal,
		);
	} catch {
		return null;
	}
}

export async function decodeRasterFrames(
	input: Buffer,
	options: DecodeRasterFramesOptions = {},
): Promise<DecodedRasterFrame[] | null> {
	const ffmpegPath = options.ffmpegPath ?? "ffmpeg";
	const fpsCap = Math.max(1, Math.min(60, Math.floor(options.fpsCap ?? 12)));
	const maxFrames = Math.max(1, Math.floor(options.maxFrames ?? 720));
	const maxOutputBytes = Math.max(1, Math.floor(options.maxOutputBytes ?? 100 * 1024 * 1024));
	const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 30_000));
	try {
		const output = await runWithInput(
			[
				ffmpegPath,
				"-v",
				"error",
				"-nostdin",
				"-i",
				"pipe:0",
				"-an",
				"-vf",
				`fps=${fpsCap},scale='min(1920,iw)':-2`,
				"-frames:v",
				String(maxFrames),
				"-f",
				"image2pipe",
				"-vcodec",
				"png",
				"pipe:1",
			],
			input,
			timeoutMs,
			maxOutputBytes,
			options.signal,
		);
		const durationMs = Math.ceil(1000 / fpsCap);
		const frames = splitPngStream(output, maxFrames);
		if (frames.length === 0) return null;
		return frames.map(data => ({ data, durationMs }));
	} catch {
		if (!isAnimatedWebp(input)) return null;
		return await decodeAnimatedWebpFallback(input, {
			ffmpegPath,
			webpmuxPath: options.webpmuxPath ?? "webpmux",
			animDumpPath: options.animDumpPath ?? "anim_dump",
			maxFrames,
			maxOutputBytes,
			timeoutMs,
			fpsCap,
			signal: options.signal,
		});
	}
}
