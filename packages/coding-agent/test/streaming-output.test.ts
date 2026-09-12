import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type ImageProtocol, TERMINAL } from "@f5-sales-demo/pi-tui/terminal-capabilities";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_COLUMN,
	DEFAULT_MAX_LINES,
	formatHeadTruncationNotice,
	formatTailTruncationNotice,
	OutputSink,
	TailBuffer,
	truncateHead,
	truncateHeadBytes,
	truncateLine,
	truncateTail,
	truncateTailBytes,
} from "../src/session/streaming-output";

const createdTempDirs: string[] = [];
const originalForceProtocol = Bun.env.PI_FORCE_IMAGE_PROTOCOL;
const originalAllowPassthrough = Bun.env.PI_ALLOW_SIXEL_PASSTHROUGH;

async function createTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "streaming-output-test-"));
	createdTempDirs.push(dir);
	return dir;
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf-8");
}

afterEach(async () => {
	for (const dir of createdTempDirs.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true });
	}
	if (originalForceProtocol === undefined) delete Bun.env.PI_FORCE_IMAGE_PROTOCOL;
	else Bun.env.PI_FORCE_IMAGE_PROTOCOL = originalForceProtocol;
	if (originalAllowPassthrough === undefined) delete Bun.env.PI_ALLOW_SIXEL_PASSTHROUGH;
	else Bun.env.PI_ALLOW_SIXEL_PASSTHROUGH = originalAllowPassthrough;
});

describe("streaming-output exports", () => {
	test("exports expected default limits", () => {
		expect(DEFAULT_MAX_LINES).toBe(3000);
		expect(DEFAULT_MAX_BYTES).toBe(50 * 1024);
		expect(DEFAULT_MAX_COLUMN).toBe(1024);
	});
});

describe("truncateTailBytes", () => {
	test("returns source when already under limit", () => {
		const text = "hello";
		expect(truncateTailBytes(text, 10)).toEqual({ text: "hello", bytes: 5 });
	});

	test("truncates from end without breaking UTF-8 boundaries", () => {
		const text = "a😀b";
		const result = truncateTailBytes(text, 4);
		expect(result).toEqual({ text: "b", bytes: 1 });
		expect(result.text).not.toContain("\uFFFD");
	});

	test("accepts Uint8Array input", () => {
		const bytes = new TextEncoder().encode("abc😀");
		const result = truncateTailBytes(bytes, 4);
		expect(result.text).toBe("😀");
		expect(result.bytes).toBe(4);
	});
});

describe("truncateHeadBytes", () => {
	test("returns source when already under limit", () => {
		const text = "hello";
		expect(truncateHeadBytes(text, 10)).toEqual({ text: "hello", bytes: 5 });
	});

	test("truncates from start without breaking UTF-8 boundaries", () => {
		const text = "a😀b";
		const result = truncateHeadBytes(text, 2);
		expect(result).toEqual({ text: "a", bytes: 1 });
		expect(result.text).not.toContain("\uFFFD");
	});

	test("returns empty when maxBytes is zero", () => {
		const result = truncateHeadBytes("abc", 0);
		expect(result).toEqual({ text: "", bytes: 0 });
	});
});

describe("truncateHead", () => {
	test("returns unmodified content when within limits", () => {
		const content = "a\nb";
		const result = truncateHead(content, { maxLines: 10, maxBytes: 20 });
		expect(result.truncated).toBeUndefined();
		expect(result.content).toBe(content);
		expect(result.truncatedBy).toBeUndefined();
	});

	test("handles first line exceeding byte limit", () => {
		const result = truncateHead("abcdef\nnext", { maxBytes: 3, maxLines: 10 });
		expect(result.content).toBe("");
		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("bytes");
		expect(result.firstLineExceedsLimit).toBe(true);
	});

	test("includes first line when text fits exact byte budget", () => {
		const result = truncateHead("abc\nx", { maxBytes: 3, maxLines: 10 });
		expect(result.content).toBe("abc");
		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("bytes");
		expect(result.firstLineExceedsLimit).toBe(false);
		expect(result.outputBytes).toBe(byteLength("abc"));
	});
	test("truncates by line count", () => {
		const result = truncateHead("l1\nl2\nl3", { maxLines: 2, maxBytes: 100 });
		expect(result.content).toBe("l1\nl2");
		expect(result.truncatedBy).toBe("lines");
		expect(result.outputLines).toBe(2);
	});

	test("truncates by byte budget using complete lines", () => {
		const result = truncateHead("12345\nabc\nz", { maxLines: 10, maxBytes: 7 });
		expect(result.content).toBe("12345");
		expect(result.truncatedBy).toBe("bytes");
		expect(result.lastLinePartial).toBe(false);
		expect(result.outputBytes).toBe(byteLength("12345"));
	});
});

describe("truncateTail", () => {
	test("returns unmodified content when within limits", () => {
		const content = "a\nb";
		const result = truncateTail(content, { maxLines: 10, maxBytes: 20 });
		expect(result.truncated).toBeUndefined();
		expect(result.content).toBe(content);
		expect(result.truncatedBy).toBeUndefined();
	});

	test("truncates by line count", () => {
		const result = truncateTail("l1\nl2\nl3", { maxLines: 2, maxBytes: 100 });
		expect(result.content).toBe("l2\nl3");
		expect(result.truncatedBy).toBe("lines");
		expect(result.outputLines).toBe(2);
	});

	test("truncates by byte budget while preserving line boundaries", () => {
		const result = truncateTail("aaa\nbbbb\ncc", { maxLines: 10, maxBytes: 6 });
		expect(result.content).toBe("cc");
		expect(result.truncatedBy).toBe("bytes");
		expect(result.lastLinePartial).toBe(false);
	});

	test("returns partial single line when last line exceeds byte limit", () => {
		const result = truncateTail("abcdefghij", { maxLines: 10, maxBytes: 4 });
		expect(result.content).toBe("ghij");
		expect(result.truncatedBy).toBe("bytes");
		expect(result.lastLinePartial).toBe(true);
	});
});

describe("truncateLine", () => {
	test("does not truncate short lines", () => {
		expect(truncateLine("hello", 10)).toEqual({ text: "hello", wasTruncated: false });
	});

	test("truncates long lines with ellipsis", () => {
		expect(truncateLine("abcdefgh", 5)).toEqual({ text: "abcde…", wasTruncated: true });
	});
});

describe("TailBuffer", () => {
	test("keeps trailing bytes under budget", () => {
		const tail = new TailBuffer(5);
		tail.append("abc");
		tail.append("def");
		expect(tail.text()).toBe("bcdef");
		expect(tail.bytes()).toBe(5);
	});

	test("handles multibyte data and empty appends", () => {
		const tail = new TailBuffer(4);
		tail.append("");
		tail.append("😀");
		tail.append("x");
		expect(tail.text()).toBe("x");
		expect(tail.bytes()).toBe(1);
	});
});

describe("OutputSink", () => {
	test("tracks totals and adds notice in dump", async () => {
		const sink = new OutputSink();
		await sink.push("hello\nworld");
		const dumped = await sink.dump("notice");

		expect(dumped.output).toBe("[notice]\nhello\nworld");
		expect(dumped.truncated).toBe(false);
		expect(dumped.totalLines).toBe(2);
		expect(dumped.totalBytes).toBe(byteLength("hello\nworld"));
		expect(dumped.outputLines).toBe(2);
		expect(dumped.outputBytes).toBe(byteLength("hello\nworld"));
	});

	test("counts lines correctly when chunks contain no newlines", async () => {
		const sink = new OutputSink();
		await sink.push("abc");
		await sink.push("def");
		const dumped = await sink.dump();

		expect(dumped.totalLines).toBe(1);
		expect(dumped.outputLines).toBe(1);
	});

	test("counts all newline boundaries across chunk splits", async () => {
		const sink = new OutputSink();
		await sink.push("a\n");
		await sink.push("b\n\n");
		await sink.push("c");
		const dumped = await sink.dump();

		expect(dumped.output).toBe("a\nb\n\nc");
		expect(dumped.totalLines).toBe(4);
		expect(dumped.outputLines).toBe(4);
	});
	test("invokes onChunk callback with sanitized text", async () => {
		const chunks: string[] = [];
		const sink = new OutputSink({ onChunk: chunk => chunks.push(chunk) });
		await sink.push("abc");
		await sink.push("def");
		expect(chunks).toEqual(["abc", "def"]);
	});

	test("preserves SIXEL chunks when image protocol is set", async () => {
		const sixel = "\x1bPqabc\x1b\\";
		const original = TERMINAL.imageProtocol;
		(TERMINAL as unknown as { imageProtocol: ImageProtocol | null }).imageProtocol =
			"\x1bPq" as unknown as ImageProtocol;
		try {
			const chunks: string[] = [];
			const sink = new OutputSink({ onChunk: chunk => chunks.push(chunk) });
			sink.push(`before\n${sixel}\nafter`);
			const dumped = await sink.dump();
			expect(chunks).toHaveLength(1);
			expect(dumped.output).toContain(sixel);
		} finally {
			(TERMINAL as unknown as { imageProtocol: ImageProtocol | null }).imageProtocol = original;
		}
	});

	test("strips SIXEL chunks when image protocol is null", async () => {
		const sixel = "\x1bPqabc\x1b\\";
		const original = TERMINAL.imageProtocol;
		(TERMINAL as unknown as { imageProtocol: ImageProtocol | null }).imageProtocol = null;
		try {
			const sink = new OutputSink();
			await sink.push(sixel);
			const dumped = await sink.dump();
			expect(dumped.output).not.toContain("\x1bPq");
			expect(dumped.output).toBe("");
		} finally {
			(TERMINAL as unknown as { imageProtocol: ImageProtocol | null }).imageProtocol = original;
		}
	});

	test("truncates in-memory output when spill threshold is exceeded", async () => {
		const sink = new OutputSink({ spillThreshold: 5 });
		await sink.push("abc");
		await sink.push("def");

		const dumped = await sink.dump();
		expect(dumped.truncated).toBe(true);
		expect(dumped.output).toBe("bcdef");
		expect(dumped.totalBytes).toBe(6);
		expect(dumped.outputBytes).toBe(5);
	});

	test("spills full output to artifact file when artifact path is provided", async () => {
		const dir = await createTempDir();
		const artifactPath = path.join(dir, "output.log");
		const sink = new OutputSink({
			artifactPath,
			artifactId: "artifact-1",
			spillThreshold: 5,
		});

		await sink.push("abc");
		await sink.push("def");
		const dumped = await sink.dump();
		const artifactText = await Bun.file(artifactPath).text();

		expect(dumped.truncated).toBe(true);
		expect(dumped.artifactId).toBe("artifact-1");
		expect(artifactText).toBe("abcdef");
		expect(dumped.output).toBe("bcdef");
	});

	test("createInput decodes streamed UTF-8 chunks correctly", async () => {
		const sink = new OutputSink();
		const writer = sink.createInput().getWriter();
		const bytes = new TextEncoder().encode("😀X");

		await writer.write(bytes.subarray(0, 2));
		await writer.write(bytes.subarray(2));
		await writer.close();

		const dumped = await sink.dump();
		expect(dumped.output).toBe("😀X");
		expect(dumped.totalBytes).toBe(byteLength("😀X"));
	});
});

describe("truncation notice formatting", () => {
	test("formatTailTruncationNotice returns empty string for non-truncated results", () => {
		const truncation = truncateTail("a\nb", { maxLines: 10, maxBytes: 50 });
		expect(formatTailTruncationNotice(truncation)).toBe("");
	});

	test("formatTailTruncationNotice supports partial-line and complete-line notices", () => {
		const partialLineTruncation = truncateTail("abcdefghij", { maxLines: 10, maxBytes: 4 });
		const partialLineNotice = formatTailTruncationNotice(partialLineTruncation, {
			fullOutputPath: "/tmp/full.log",
			originalContent: "abcdefghij",
			suffix: " [suffix]",
		});
		expect(partialLineNotice).toBe(
			"\n\n[Showing last 4B of line 1 (line is 10B). Full output: /tmp/full.log [suffix]]",
		);

		const lineTruncation = truncateTail("l1\nl2\nl3", { maxLines: 2, maxBytes: 100 });
		expect(formatTailTruncationNotice(lineTruncation)).toBe("\n\n[Showing lines 2-3 of 3]");

		const byteTruncation = truncateTail("aaa\nbbbb\ncc", { maxLines: 10, maxBytes: 6 });
		expect(formatTailTruncationNotice(byteTruncation)).toBe("\n\n[Showing lines 3-3 of 3]");
	});

	test("formatHeadTruncationNotice returns empty string for non-truncated results", () => {
		const truncation = truncateHead("a\nb", { maxLines: 10, maxBytes: 50 });
		expect(formatHeadTruncationNotice(truncation)).toBe("");
	});

	test("formatHeadTruncationNotice formats head truncation range", () => {
		const lineTruncation = truncateHead("l1\nl2\nl3", { maxLines: 2, maxBytes: 100 });
		expect(formatHeadTruncationNotice(lineTruncation)).toBe("\n\n[Showing lines 1-2 of 3. Use sel=L3 to continue]");

		const byteTruncation = truncateHead("12345\nabc\nz", { maxLines: 10, maxBytes: 7 });
		expect(
			formatHeadTruncationNotice(byteTruncation, {
				startLine: 100,
				totalFileLines: 500,
			}),
		).toBe("\n\n[Showing lines 100-100 of 500. Use sel=L101 to continue]");
	});
});

describe("lossless throttled output", () => {
	test("dump flushes throttled chunks in order exactly once", async () => {
		const chunks: string[] = [];
		const sink = new OutputSink({ chunkThrottleMs: 60_000, onChunk: chunk => chunks.push(chunk) });
		sink.push("first");
		sink.push("second");
		sink.push("third");
		const output = await sink.dump();
		expect(chunks.join("")).toBe("firstsecondthird");
		expect(output.output).toBe(chunks.join(""));
		await sink.dump();
		expect(chunks.join("")).toBe("firstsecondthird");
	});
	test("pending output is delivered when the producer pauses", async () => {
		const chunks: string[] = [];
		const delivered = Promise.withResolvers<void>();
		const sink = new OutputSink({
			chunkThrottleMs: 10,
			onChunk: chunk => {
				chunks.push(chunk);
				if (chunks.join("") === "firstsecond") delivered.resolve();
			},
		});
		sink.push("first");
		sink.push("second");
		await Promise.race([
			delivered.promise,
			Bun.sleep(200).then(() => {
				throw new Error("Paused output was not flushed");
			}),
		]);
		expect(chunks.join("")).toBe("firstsecond");
		await sink.dump();
	});
	test("large unicode output preserves every character with bounded callback batches", async () => {
		const chunks: string[] = [];
		const sink = new OutputSink({ chunkThrottleMs: 60_000, onChunk: chunk => chunks.push(chunk) });
		const text = "🦊é中".repeat(DEFAULT_MAX_BYTES);
		sink.push(text);
		await sink.dump();
		expect(chunks.join("")).toBe(text);
		expect(chunks.every(chunk => Buffer.byteLength(chunk) <= DEFAULT_MAX_BYTES && chunk.isWellFormed())).toBe(true);
	});
	test("secret masking applies before queued output is delivered", async () => {
		const chunks: string[] = [];
		const sink = new OutputSink({
			chunkThrottleMs: 60_000,
			maskSecrets: text => text.replaceAll("fixture-secret", "[masked]"),
			onChunk: chunk => chunks.push(chunk),
		});
		sink.push("start ");
		sink.push("fixture-secret");
		await sink.dump();
		expect(chunks.join("")).toBe("start [masked]");
	});
});

test("a paused output callback failure is returned to the executor by dump", async () => {
	let calls = 0;
	const error = new Error("Fixture output consumer failed");
	const sink = new OutputSink({
		chunkThrottleMs: 10,
		onChunk: () => {
			if (++calls > 1) throw error;
		},
	});
	sink.push("first");
	sink.push("second");
	await Bun.sleep(30);
	await expect(sink.dump()).rejects.toBe(error);
});

test("dump closes artifact output even when the queued output consumer fails", async () => {
	const dir = await createTempDir();
	const artifactPath = path.join(dir, "output.txt");
	let calls = 0;
	const sink = new OutputSink({
		artifactPath,
		spillThreshold: 1,
		chunkThrottleMs: 60_000,
		onChunk: () => {
			if (++calls > 1) throw new Error("Fixture consumer failure");
		},
	});
	sink.push("first");
	sink.push("second");
	await expect(sink.dump()).rejects.toThrow("Fixture consumer failure");
	if (process.platform === "linux") {
		const descriptors = await fs.readdir("/proc/self/fd");
		const targets = await Promise.all(descriptors.map(fd => fs.readlink(`/proc/self/fd/${fd}`).catch(() => "")));
		expect(targets).not.toContain(artifactPath);
	}
	expect(await Bun.file(artifactPath).text()).toBe("firstsecond");
});
