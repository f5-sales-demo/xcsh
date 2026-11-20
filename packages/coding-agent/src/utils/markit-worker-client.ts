import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolAbortError } from "../tools/tool-errors";

declare const PI_COMPILED: boolean;
type ConversionRequest = { operation: "file"; path: string } | { operation: "buffer"; data: string; extension: string };

async function collect(stream: ReadableStream<Uint8Array>, maximum: number): Promise<string> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maximum) throw new Error("Conversion worker output exceeds size limit");
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** Isolate native addons whose static thread-local storage cannot coexist in one process. */
async function runFileWorker(request: { operation: "file"; path: string }, signal?: AbortSignal): Promise<string> {
	if (signal?.aborted) throw new ToolAbortError();
	const command =
		typeof PI_COMPILED !== "undefined" && PI_COMPILED
			? [process.execPath, "--xcsh-native-markit-worker"]
			: [process.execPath, path.join(import.meta.dir, "markit-worker.ts")];
	const child = Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	const abort = () => child.kill();
	signal?.addEventListener("abort", abort, { once: true });
	try {
		child.stdin.write(JSON.stringify(request));
		child.stdin.end();
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			collect(child.stdout, 128 * 1024 * 1024),
			collect(child.stderr, 64 * 1024),
		]);
		if (signal?.aborted) throw new ToolAbortError();
		if (code !== 0) throw new Error(stderr || `Native conversion worker failed (${code})`);
		const response: unknown = JSON.parse(stdout);
		if (
			typeof response !== "object" ||
			response === null ||
			!("markdown" in response) ||
			typeof response.markdown !== "string"
		) {
			throw new Error("Invalid conversion worker response");
		}
		return response.markdown;
	} finally {
		signal?.removeEventListener("abort", abort);
		if (child.exitCode === null) {
			child.kill();
			await child.exited;
		}
	}
}

export async function convertInMarkitWorker(request: ConversionRequest, signal?: AbortSignal): Promise<string> {
	if (request.operation === "file") return runFileWorker(request, signal);
	if (signal?.aborted) throw new ToolAbortError();
	const directory = await mkdtemp(path.join(os.tmpdir(), "xcsh-markit-input-"));
	let failed = false;
	let failure: unknown;
	let markdown: string | undefined;
	try {
		const extension = /^\.[a-z0-9]{1,12}$/i.test(request.extension) ? request.extension : ".bin";
		const filename = path.join(directory, `document${extension}`);
		await writeFile(filename, Buffer.from(request.data, "base64"), { mode: 0o600 });
		markdown = await runFileWorker({ operation: "file", path: filename }, signal);
	} catch (error) {
		failed = true;
		failure = error;
	}
	try {
		await rm(directory, { recursive: true, force: true });
	} catch (error) {
		if (failed)
			throw new AggregateError([failure, error], "Conversion and staging cleanup failed", { cause: failure });
		throw error;
	}
	if (failed) throw failure;
	if (markdown === undefined) throw new Error("Conversion did not return markdown");
	return markdown;
}
