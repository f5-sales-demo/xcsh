import * as fs from "node:fs/promises";
import * as path from "node:path";
import { gzipSync } from "node:zlib";

export interface ArchiveEntry {
	readonly path: string;
	readonly bytes: Uint8Array;
}

const TAR_BLOCK_SIZE = 512;

function writeString(header: Uint8Array, offset: number, length: number, value: string): void {
	const encoded = Buffer.from(value, "utf8");
	if (encoded.length > length) throw new Error(`TAR field is too long: ${value}`);
	header.set(encoded, offset);
}

function writeOctal(header: Uint8Array, offset: number, length: number, value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid TAR numeric value: ${value}`);
	const encoded = value.toString(8).padStart(length - 1, "0");
	if (encoded.length >= length) throw new Error(`TAR numeric field is too large: ${value}`);
	writeString(header, offset, length, `${encoded}\0`);
}

function splitTarPath(archivePath: string): { name: string; prefix: string } {
	const normalized = archivePath.replaceAll("\\", "/");
	const parts = normalized.split("/");
	if (!normalized || normalized.startsWith("/") || parts.some(part => !part || part === "." || part === "..")) {
		throw new Error(`Invalid archive path: ${archivePath}`);
	}
	if (Buffer.byteLength(normalized) <= 100) return { name: normalized, prefix: "" };

	for (let index = normalized.lastIndexOf("/"); index > 0; index = normalized.lastIndexOf("/", index - 1)) {
		const prefix = normalized.slice(0, index);
		const name = normalized.slice(index + 1);
		if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
	}
	throw new Error(`Archive path exceeds the USTAR limits: ${archivePath}`);
}

function createTarHeader(entry: ArchiveEntry): Uint8Array {
	const header = new Uint8Array(TAR_BLOCK_SIZE);
	const { name, prefix } = splitTarPath(entry.path);
	writeString(header, 0, 100, name);
	writeOctal(header, 100, 8, 0o644);
	writeOctal(header, 108, 8, 0);
	writeOctal(header, 116, 8, 0);
	writeOctal(header, 124, 12, entry.bytes.byteLength);
	writeOctal(header, 136, 12, 0);
	header.fill(0x20, 148, 156);
	header[156] = "0".charCodeAt(0);
	writeString(header, 257, 6, "ustar\0");
	writeString(header, 263, 2, "00");
	writeString(header, 345, 155, prefix);

	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	const checksumOctal = checksum.toString(8).padStart(6, "0");
	if (checksumOctal.length > 6) throw new Error(`TAR header checksum is too large: ${checksum}`);
	writeString(header, 148, 8, `${checksumOctal}\0 `);
	return header;
}

/** Create a byte-stable USTAR+gzip archive without wall-clock metadata. */
export function createDeterministicTarGzip(entries: readonly ArchiveEntry[]): Uint8Array {
	const ordered = [...entries].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
	);
	const totalSize = ordered.reduce(
		(total, entry) => total + TAR_BLOCK_SIZE + Math.ceil(entry.bytes.byteLength / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE,
		TAR_BLOCK_SIZE * 2,
	);
	const tar = new Uint8Array(totalSize);
	let offset = 0;

	for (const entry of ordered) {
		const header = createTarHeader(entry);
		tar.set(header, offset);
		offset += TAR_BLOCK_SIZE;
		tar.set(entry.bytes, offset);
		offset += Math.ceil(entry.bytes.byteLength / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
	}

	return gzipSync(tar, { level: 9 });
}

async function collectFiles(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectFiles(fullPath)));
		} else if (entry.isFile()) {
			files.push(fullPath);
		}
	}
	return files;
}

/** Archive a directory with stable ordering, metadata, and compression. */
export async function buildDeterministicArchiveBase64(dir: string): Promise<string> {
	const files = await collectFiles(dir);
	const entries = await Promise.all(
		files.map(async filePath => ({
			path: path.relative(dir, filePath).split(path.sep).join("/"),
			bytes: await fs.readFile(filePath),
		})),
	);
	return Buffer.from(createDeterministicTarGzip(entries)).toString("base64");
}
