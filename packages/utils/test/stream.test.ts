import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5xc-salesdemos/pi-natives";
import {
	OutputTooLargeError,
	parseJsonlLenient,
	readJsonl,
	readLines,
	readSseJson,
	readStreamCapped,
	readStreamCappedText,
} from "../src/stream";

const encoder = new TextEncoder();

async function runStringTransform(transform: TransformStream<string, string>, chunks: string[]): Promise<string[]> {
	const readable = new ReadableStream<string>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});

	const reader = readable.pipeThrough(transform).getReader();
	const output: string[] = [];
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		output.push(value);
	}
	return output;
}

async function collectAsync<T>(iter: AsyncIterable<T>): Promise<T[]> {
	const output: T[] = [];
	for await (const item of iter) output.push(item);
	return output;
}

describe("sanitizeText", () => {
	it("strips ANSI and normalizes CR", () => {
		const input = "\u001b[31mred\u001b[0m\r\n";
		expect(sanitizeText(input)).toBe("red\n");
	});
});

describe("readLines", () => {
	it("splits lines across chunks without newlines", async () => {
		const readable = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode("alpha\nbe"));
				controller.enqueue(encoder.encode("ta\ngam"));
				controller.enqueue(encoder.encode("ma"));
				controller.close();
			},
		});

		const output: string[] = [];
		const dec = new TextDecoder();
		for await (const line of readLines(readable)) {
			output.push(dec.decode(line));
		}

		expect(output).toEqual(["alpha", "beta", "gamma"]);
	});
});

describe("readJsonl", () => {
	it("parses JSONL across chunk boundaries", async () => {
		const readable = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode('{"a":1}\n{"b":'));
				controller.enqueue(encoder.encode('2}\n{"c":3}\n'));
				controller.close();
			},
		});

		const output = await collectAsync(readJsonl(readable));
		expect(output).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
	});

	it("parses trailing line without newline", async () => {
		const readable = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode('{"z":9}'));
				controller.close();
			},
		});

		const output = await collectAsync(readJsonl(readable));
		expect(output).toEqual([{ z: 9 }]);
	});
});

describe("createSanitizerStream", () => {
	it("sanitizes text chunks", async () => {
		const transform = new TransformStream<string, string>({
			transform(chunk, controller) {
				controller.enqueue(sanitizeText(chunk));
			},
		});
		const output = await runStringTransform(transform, ["\u001b[34mhi\u001b[0m\r\n"]);

		expect(output).toEqual(["hi\n"]);
	});
});

describe("parseJsonlLenient", () => {
	it("parses valid JSONL", () => {
		const result = parseJsonlLenient<{ a: number }>('{"a":1}\n{"a":2}\n{"a":3}\n');
		expect(result).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
	});

	it("skips malformed lines and continues", () => {
		const result = parseJsonlLenient<{ a: number }>('{"a":1}\n{bad json}\n{"a":3}\n');
		expect(result).toEqual([{ a: 1 }, { a: 3 }]);
	});

	it("returns empty array for empty input", () => {
		expect(parseJsonlLenient("")).toEqual([]);
	});

	it("handles input without trailing newline", () => {
		const result = parseJsonlLenient<{ x: number }>('{"x":42}');
		expect(result).toEqual([{ x: 42 }]);
	});
});

describe("readSseJson", () => {
	it("parses data lines and stops at [DONE]", async () => {
		const chunks = [
			encoder.encode('data: {"a":1}\n'),
			encoder.encode("event: ping\n"),
			encoder.encode('data: {"b":2}\r\n'),
			encoder.encode("data: [DONE]\n"),
			encoder.encode('data: {"c":3}\n'),
		];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		});

		const output = await collectAsync(readSseJson(stream));
		expect(output).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it("parses trailing line without newline", async () => {
		const chunks = [encoder.encode('data: {"c":3}')];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		});

		const output = await collectAsync(readSseJson(stream));
		expect(output).toEqual([{ c: 3 }]);
	});

	it("handles data lines split across chunks", async () => {
		const chunks = [encoder.encode('data: {"a"'), encoder.encode(":1}\n")];
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		});

		const output = await collectAsync(readSseJson(stream));
		expect(output).toEqual([{ a: 1 }]);
	});
});

describe("readStreamCapped", () => {
	function byteStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
		return new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		});
	}

	it("returns the full bytes when the stream is under the cap", async () => {
		const out = await readStreamCapped(byteStream([encoder.encode("hello world")]), { maxBytes: 1024 });
		expect(new TextDecoder().decode(out)).toBe("hello world");
	});

	it("concatenates multiple chunks in order", async () => {
		const out = await readStreamCapped(
			byteStream([encoder.encode("ab"), encoder.encode("cd"), encoder.encode("ef")]),
			{
				maxBytes: 1024,
			},
		);
		expect(new TextDecoder().decode(out)).toBe("abcdef");
	});

	it("throws OutputTooLargeError when the stream exceeds the cap", async () => {
		const chunk = new Uint8Array(1024); // 1 KiB
		const chunks = Array.from({ length: 10 }, () => chunk); // 10 KiB total
		await expect(readStreamCapped(byteStream(chunks), { maxBytes: 4096, source: "test-cmd" })).rejects.toBeInstanceOf(
			OutputTooLargeError,
		);
	});

	it("OutputTooLargeError carries the cap and source label", async () => {
		const big = new Uint8Array(8192);
		try {
			await readStreamCapped(byteStream([big]), { maxBytes: 1024, source: "git diff" });
			throw new Error("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(OutputTooLargeError);
			expect((err as OutputTooLargeError).maxBytes).toBe(1024);
			expect((err as OutputTooLargeError).source).toBe("git diff");
		}
	});

	it("readStreamCappedText decodes UTF-8 under the cap", async () => {
		const out = await readStreamCappedText(byteStream([encoder.encode("café ☕")]), { maxBytes: 1024 });
		expect(out).toBe("café ☕");
	});

	it("rejects when the signal is already aborted", async () => {
		const ac = new AbortController();
		ac.abort();
		await expect(readStreamCapped(byteStream([encoder.encode("x")]), { signal: ac.signal })).rejects.toBeTruthy();
	});
});
