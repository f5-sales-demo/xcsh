import { TERMINAL } from "@f5-sales-demo/pi-tui/terminal-capabilities";

// -- Start sequence detection regexes --

const SIXEL_START_REGEX = /\x1bP(?:[0-9;]*)q/u;
// Match all iTerm2 image sequences: File=, MultipartFile=, FilePart=, FileEnd
const ITERM2_START_REGEX = /\x1b\]1337;(?:File=|MultipartFile=|FilePart=|FileEnd)/u;
const KITTY_START_REGEX = /\x1b_G/u;

// -- Full sequence matching regexes (for placeholder/restore) --

const SIXEL_SEQUENCE_REGEX = /\x1bP(?:[0-9;]*)q[\s\S]*?(?:\x1b\\|\x07)/gu;
// Match all iTerm2 image OSC sequences through their terminator (BEL or ST).
// Covers File= (inline), MultipartFile= (multipart start), FilePart= (chunks), FileEnd.
const ITERM2_SEQUENCE_REGEX = /\x1b\]1337;(?:File=|MultipartFile=|FilePart=|FileEnd)[\s\S]*?(?:\x07|\x1b\\)/gu;
const KITTY_SEQUENCE_REGEX = /\x1b_G[^\x1b]*\x1b\\/gu;

const SIXEL_END_SEQUENCE = "\x1b\\";
const SIXEL_END_BELL = "\x07";

const PLACEHOLDER_PREFIX = "__OMP_IMAGE_SEQUENCE_";

export function isImagePassthroughEnabled(): boolean {
	return TERMINAL.imageProtocol !== null;
}

export function containsImageSequence(text: string): boolean {
	return SIXEL_START_REGEX.test(text) || ITERM2_START_REGEX.test(text) || KITTY_START_REGEX.test(text);
}

export function isImageLine(line: string): boolean {
	return containsImageSequence(line);
}

export function getImageLineMask(lines: string[]): boolean[] {
	let inSixelSequence = false;
	return lines.map(line => {
		const hasSixelStart = SIXEL_START_REGEX.test(line);
		const hasIterm2 = ITERM2_START_REGEX.test(line);
		const hasKitty = KITTY_START_REGEX.test(line);

		if (hasSixelStart) {
			inSixelSequence = true;
		}

		const isImage = inSixelSequence || hasIterm2 || hasKitty;

		if (inSixelSequence && (line.includes(SIXEL_END_SEQUENCE) || line.includes(SIXEL_END_BELL))) {
			inSixelSequence = false;
		}

		return isImage;
	});
}

/**
 * Extracts base64 image data from iTerm2 multipart sequences in raw output.
 * Returns the reassembled base64 string and detected mime type, or null
 * if no multipart image is found.
 */
export function extractITerm2ImageData(text: string): { base64: string; mimeType: string } | null {
	if (!ITERM2_START_REGEX.test(text)) return null;

	// Check for single-part File= first
	const singleMatch = text.match(/\x1b\]1337;File=([^:]*):([A-Za-z0-9+/=\s]+)(?:\x07|\x1b\\)/u);
	if (singleMatch) {
		const base64 = singleMatch[2].replace(/\s/g, "");
		const mimeType = detectMimeFromBase64(base64);
		return { base64, mimeType };
	}

	// Reassemble multipart: collect all FilePart payloads in order
	const partRegex = /\x1b\]1337;FilePart=([A-Za-z0-9+/=\s]+)(?:\x07|\x1b\\)/gu;
	const parts: string[] = [];
	for (;;) {
		const match = partRegex.exec(text);
		if (!match) break;
		parts.push(match[1].replace(/\s/g, ""));
	}

	if (parts.length === 0) return null;

	const base64 = parts.join("");
	const mimeType = detectMimeFromBase64(base64);
	return { base64, mimeType };
}

function detectMimeFromBase64(base64: string): string {
	const header = base64.slice(0, 12);
	if (header.startsWith("iVBOR")) return "image/png";
	if (header.startsWith("/9j/")) return "image/jpeg";
	if (header.startsWith("R0lGO")) return "image/gif";
	if (header.startsWith("UklGR")) return "image/webp";
	return "image/png";
}

export function sanitizeWithImagePassthrough(text: string, sanitize: (text: string) => string): string {
	if (!isImagePassthroughEnabled() || !containsImageSequence(text)) {
		return sanitize(text);
	}

	const preservedSequences: string[] = [];

	let tokenized = text;
	for (const regex of [SIXEL_SEQUENCE_REGEX, ITERM2_SEQUENCE_REGEX, KITTY_SEQUENCE_REGEX]) {
		tokenized = tokenized.replace(regex, match => {
			const token = `${PLACEHOLDER_PREFIX}${preservedSequences.length}__`;
			preservedSequences.push(match);
			return token;
		});
	}

	const sanitized = sanitize(tokenized);
	return sanitized.replace(/__OMP_IMAGE_SEQUENCE_(\d+)__/gu, (_, indexText: string) => {
		const index = Number.parseInt(indexText, 10);
		return preservedSequences[index] ?? "";
	});
}
