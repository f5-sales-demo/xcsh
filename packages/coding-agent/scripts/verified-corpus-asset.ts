import { createHash } from "node:crypto";
import type { CorpusSource } from "./corpus-sources";
import { fetchTerraformSnapshot } from "./terraform-snapshot-download";

export type AssetRequest = (url: string, options?: RequestInit) => Promise<Response>;
export interface CorpusDownloadOptions {
	/** Bounded fixture deadlines may be shorter than the fixed production limit. */
	timeoutMs?: number;
}

export async function downloadCorpusBytes(
	url: string,
	maximum: number,
	request: AssetRequest = fetchTerraformSnapshot,
	options: CorpusDownloadOptions = {},
): Promise<Uint8Array> {
	const timeoutMs = options.timeoutMs ?? 60_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000)
		throw new Error("Invalid corpus download deadline");
	if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 1024 ** 3)
		throw new Error("Invalid corpus download size bound");
	const controller = new AbortController();
	const timeoutError = new Error("Corpus download timed out");
	let expired = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			expired = true;
			reject(timeoutError);
			controller.abort(timeoutError);
		}, timeoutMs);
	});
	const wait = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, timeout]);
	let reader: Pick<ReadableStreamDefaultReader<Uint8Array>, "read" | "cancel" | "releaseLock"> | undefined;
	const chunks: Uint8Array[] = [];
	let size = 0;
	let failed = false;
	let failure: unknown;
	try {
		const response = await wait(request(url, { signal: controller.signal }));
		if (!response.body) throw new Error(`Corpus download failed: HTTP ${response.status}`);
		const bodyReader = response.body.getReader();
		reader = bodyReader;
		if (!response.ok) throw new Error(`Corpus download failed: HTTP ${response.status}`);
		while (true) {
			const chunk = await wait(bodyReader.read());
			if (chunk.done) break;
			if (!(chunk.value instanceof Uint8Array)) throw new Error("Corpus download produced a non-binary chunk");
			size += chunk.value.byteLength;
			if (size > maximum) throw new Error("Corpus asset bytes mismatch: size bound exceeded");
			chunks.push(chunk.value);
		}
	} catch (error) {
		failed = true;
		failure = expired ? timeoutError : error;
	}
	if (reader) {
		try {
			const cancellation = reader.cancel();
			if (expired) {
				// Settle immediate cancellation outcomes without extending the original
				// deadline; a pending cleanup remains an explicit failure.
				const pending = Symbol("unconfirmed cancellation");
				const result = await Promise.race([cancellation, Promise.resolve().then(() => pending)]);
				if (result === pending) throw new Error("Corpus reader cancellation unconfirmed at original deadline");
			} else {
				await wait(cancellation);
			}
		} catch (error) {
			failure = failed
				? new AggregateError(
						[failure, error],
						expired
							? "Corpus download timed out and reader cleanup failed"
							: "Corpus download and reader cleanup failed",
						{ cause: failure },
					)
				: error;
			failed = true;
		}
		try {
			reader.releaseLock();
		} catch (error) {
			failure = failed
				? new AggregateError([failure, error], "Corpus download and reader release failed", { cause: failure })
				: error;
			failed = true;
		}
	}
	clearTimeout(timer);
	if (failed) throw failure;
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export async function downloadVerifiedCorpusAsset(
	source: CorpusSource,
	name: string,
	request: AssetRequest = fetchTerraformSnapshot,
	options: CorpusDownloadOptions = {},
): Promise<Uint8Array> {
	if (!/^[A-Za-z0-9_.-]+$/.test(name) || [".", "..", "__proto__", "prototype", "constructor"].includes(name))
		throw new Error("Unsafe corpus asset name");
	const expected = source.assets[name];
	if (!expected) throw new Error(`Missing published corpus asset: ${name}`);
	if (
		!Number.isSafeInteger(expected.size_bytes) ||
		expected.size_bytes < 0 ||
		expected.size_bytes > 1024 ** 3 ||
		!/^[a-f0-9]{64}$/.test(expected.sha256)
	)
		throw new Error(`Invalid published corpus asset identity: ${name}`);
	const bytes = await downloadCorpusBytes(
		`https://github.com/${source.repository}/releases/download/${encodeURIComponent(source.tag)}/${encodeURIComponent(name)}`,
		expected.size_bytes,
		request,
		options,
	);
	if (bytes.byteLength !== expected.size_bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256)
		throw new Error(`Corpus asset bytes mismatch: ${name}`);
	return bytes;
}
