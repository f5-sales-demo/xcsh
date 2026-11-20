import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { CorpusSource } from "../../scripts/corpus-sources";
import { downloadVerifiedCorpusAsset } from "../../scripts/verified-corpus-asset";

const payload = new TextEncoder().encode("verified bounded bytes");
const source: CorpusSource = {
	repository: "f5-sales-demo/html-to-markdown",
	tag: "content-20260101T000000Z",
	commit: "a".repeat(40),
	acceptance: "immutable",
	assets: {
		"manifest.json": { sha256: createHash("sha256").update(payload).digest("hex"), size_bytes: payload.length },
	},
};

test("a slow header response uses the original download deadline and aborts", async () => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let aborted = false;
	try {
		await expect(
			downloadVerifiedCorpusAsset(
				source,
				"manifest.json",
				(_url, options) =>
					new Promise<Response>((resolve, reject) => {
						timer = setTimeout(() => resolve(new Response(payload)), 200);
						options?.signal?.addEventListener(
							"abort",
							() => {
								aborted = true;
								clearTimeout(timer);
								reject(new Error("request aborted"));
							},
							{ once: true },
						);
					}),
				{ timeoutMs: 20 },
			),
		).rejects.toThrow("timed out");
		expect(aborted).toBe(true);
	} finally {
		clearTimeout(timer);
	}
});

test("a stalled body cannot outlive the original deadline and its reader is cancelled", async () => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			timer = setTimeout(() => {
				controller.enqueue(payload);
				controller.close();
			}, 200);
		},
		cancel() {
			cancelled = true;
			clearTimeout(timer);
		},
	});
	try {
		await expect(
			downloadVerifiedCorpusAsset(source, "manifest.json", async () => new Response(body), { timeoutMs: 20 }),
		).rejects.toThrow("timed out");
		expect(cancelled).toBe(true);
	} finally {
		clearTimeout(timer);
	}
});

test("test download deadlines cannot relax the production bound", async () => {
	let calls = 0;
	await expect(
		downloadVerifiedCorpusAsset(
			source,
			"manifest.json",
			async () => {
				calls++;
				return new Response(payload);
			},
			{ timeoutMs: 60001 },
		),
	).rejects.toThrow("deadline");
	expect(calls).toBe(0);
});

test("deadline cancellation failure retains the timeout and actual cancellation cause", async () => {
	const cleanup = new Error("reader cancellation failure");
	const body = new ReadableStream<Uint8Array>({
		cancel() {
			throw cleanup;
		},
	});
	let failure: unknown;
	try {
		await downloadVerifiedCorpusAsset(source, "manifest.json", async () => new Response(body), { timeoutMs: 20 });
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(AggregateError);
	expect((failure as AggregateError).errors).toContain(cleanup);
	expect(
		(failure as AggregateError).errors.some(error => error instanceof Error && error.message.includes("timed out")),
	).toBe(true);
});
test("unconfirmed cancellation cannot extend the original deadline", async () => {
	const body = new ReadableStream<Uint8Array>({ cancel: () => new Promise<void>(() => {}) });
	let failure: unknown;
	try {
		await downloadVerifiedCorpusAsset(source, "manifest.json", async () => new Response(body), { timeoutMs: 20 });
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(AggregateError);
	expect(
		(failure as AggregateError).errors.some(error => error instanceof Error && error.message.includes("unconfirmed")),
	).toBe(true);
});
