import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, posix, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import references from "./voice-runtime-reference.json";

type FetchInput = (url: string, options: RequestInit) => Promise<Response>;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export async function voiceInputBytes(
	label: string,
	url: string,
	expected: string,
	provided?: string,
	fetcher: FetchInput = fetch,
): Promise<Uint8Array> {
	const maximum = 64 * 1024 * 1024;
	let bytes: Uint8Array;
	if (provided) {
		const requested = resolve(provided);
		const file = join(await realpath(dirname(requested)), basename(requested));
		const info = await lstat(file);
		if (!info.isFile() || info.size > maximum || (await realpath(file)) !== file)
			throw new Error(`Invalid native input file: ${label}`);
		bytes = await readFile(file);
	} else {
		const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
		if (!response.ok) throw new Error(`Native input fetch failed: ${label} (HTTP ${response.status})`);
		if (!response.body) throw new Error(`Missing native input body: ${label}`);
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const next = await reader.read();
				if (next.done) break;
				size += next.value.length;
				if (size > maximum) throw new Error(`Oversized native input: ${label}`);
				chunks.push(next.value);
			}
		} finally {
			await reader.cancel().catch(() => {});
		}
		bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}
	}
	if (bytes.length > maximum || hash(bytes) !== expected) throw new Error(`Native input hash mismatch: ${label}`);
	return bytes;
}

export async function prepareVoiceInputs(output: string): Promise<void> {
	const root = resolve(output);
	await mkdir(root, { recursive: false });
	for (const [path, digest] of Object.entries(references.files)) {
		const bytes = await voiceInputBytes(
			path,
			`https://raw.githubusercontent.com/openai/codex/${references.reference}/${path}`,
			digest,
		);
		await mkdir(dirname(join(root, path)), { recursive: true });
		await Bun.write(join(root, path), bytes);
	}
	const manifest = (await Bun.file(join(root, "third_party/voice/sources.json")).json()) as {
		sources: { name: string; url: string; archive: string; sha256: string }[];
	};
	await mkdir(join(root, "archives"));
	for (const source of manifest.sources) {
		if (source.archive !== posix.basename(source.archive)) throw new Error("Invalid native archive name");
		const bytes = await voiceInputBytes(source.name, source.url, source.sha256);
		await Bun.write(join(root, "archives", source.archive), bytes);
	}
	await Bun.write(
		join(root, "input-receipt.json"),
		JSON.stringify(
			{
				reference: references.reference,
				files: references.files,
				archives: manifest.sources.map(({ archive, sha256 }) => ({ archive, sha256 })),
			},
			null,
			2,
		),
	);
}

if (import.meta.main) await prepareVoiceInputs(process.argv[2] ?? "voice-native-inputs");
