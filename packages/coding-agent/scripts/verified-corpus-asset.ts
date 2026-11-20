import { createHash } from "node:crypto";
import type { CorpusSource } from "./corpus-sources";
import { fetchTerraformSnapshot } from "./terraform-snapshot-download";

export type AssetRequest = (url: string) => Promise<Response>;
export async function downloadVerifiedCorpusAsset(
	source: CorpusSource,
	name: string,
	request: AssetRequest = fetchTerraformSnapshot,
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
	const response = await request(
		`https://github.com/${source.repository}/releases/download/${encodeURIComponent(source.tag)}/${encodeURIComponent(name)}`,
	);
	if (!response.ok || !response.body)
		throw new Error(`Corpus asset download failed: ${name}: HTTP ${response.status}`);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	const hash = createHash("sha256");
	let size = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > expected.size_bytes) throw new Error(`Corpus asset bytes mismatch: ${name}`);
			hash.update(chunk.value);
			chunks.push(chunk.value);
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
	if (size !== expected.size_bytes || hash.digest("hex") !== expected.sha256)
		throw new Error(`Corpus asset bytes mismatch: ${name}`);
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
