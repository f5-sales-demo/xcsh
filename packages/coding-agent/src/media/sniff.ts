import type { MediaKind } from "./types";

export interface SniffedMedia {
	mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "video/mp4";
	kind: Extract<MediaKind, "image" | "video" | "animation">;
	width?: number;
	height?: number;
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | undefined {
	let offset = 2;
	while (offset + 9 < buffer.length) {
		if (buffer[offset] !== 0xff) {
			offset++;
			continue;
		}
		const marker = buffer[offset + 1] ?? 0;
		if (marker >= 0xc0 && marker <= 0xc3) {
			return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
		}
		if (offset + 3 >= buffer.length) return undefined;
		const length = buffer.readUInt16BE(offset + 2);
		if (length < 2) return undefined;
		offset += length + 2;
	}
	return undefined;
}

export function sniffMedia(buffer: Buffer): SniffedMedia | null {
	if (
		buffer.length >= 24 &&
		buffer[0] === 0x89 &&
		buffer.subarray(1, 8).equals(Buffer.from([0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
	) {
		return {
			mimeType: "image/png",
			kind: "image",
			width: buffer.readUInt32BE(16),
			height: buffer.readUInt32BE(20),
		};
	}
	if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
		return { mimeType: "image/jpeg", kind: "image", ...jpegDimensions(buffer) };
	}
	if (buffer.length >= 10 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
		return {
			mimeType: "image/gif",
			kind: "animation",
			width: buffer.readUInt16LE(6),
			height: buffer.readUInt16LE(8),
		};
	}
	if (
		buffer.length >= 16 &&
		buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
		buffer.subarray(8, 12).toString("ascii") === "WEBP"
	) {
		const chunk = buffer.subarray(12, 16).toString("ascii");
		let width: number | undefined;
		let height: number | undefined;
		let animated = buffer.includes(Buffer.from("ANIM"));
		if (chunk === "VP8X" && buffer.length >= 30) {
			animated ||= ((buffer[20] ?? 0) & 0x02) !== 0;
			width = 1 + (buffer[24] ?? 0) + ((buffer[25] ?? 0) << 8) + ((buffer[26] ?? 0) << 16);
			height = 1 + (buffer[27] ?? 0) + ((buffer[28] ?? 0) << 8) + ((buffer[29] ?? 0) << 16);
		}
		return { mimeType: "image/webp", kind: animated ? "animation" : "image", width, height };
	}
	if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
		return { mimeType: "video/mp4", kind: "video" };
	}
	return null;
}
