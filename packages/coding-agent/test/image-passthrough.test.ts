import { afterEach, describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { ImageProtocol, TERMINAL } from "@f5-sales-demo/pi-tui/terminal-capabilities";
import {
	containsImageSequence,
	extractITerm2ImageData,
	getImageLineMask,
	isImageLine,
	isImagePassthroughEnabled,
	sanitizeWithImagePassthrough,
} from "@f5-sales-demo/xcsh/utils/image-passthrough";

// Minimal image protocol fixtures
const ITERM2_SEQUENCE =
	"\x1b]1337;File=inline=1;width=80;height=auto:aVZCT1J3MEtHZ29BQUFBTlNVaEVVZ0FBQUFFQUFBQUJDQUFBQUFBNmZwdFZBQUFBQ2tsRVFWUjRuR05nQUFBQUFnQUJTSytrY1FBQUFBQkpSVTVFcmtKZ2dnPT0=\x07";
const ITERM2_MULTIPART_START = "\x1b]1337;MultipartFile=inline=1;size=2565;name=dGVzdC5wbmc=\x07";
const ITERM2_FILEPART = "\x1b]1337;FilePart=QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=\x07";
const ITERM2_FILEEND = "\x1b]1337;FileEnd\x07";
const KITTY_SEQUENCE =
	"\x1b_Ga=T,f=100,q=2;aVZCT1J3MEtHZ29BQUFBTlNVaEVVZ0FBQUFFQUFBQUJDQUFBQUFBNmZwdFZBQUFBQ2tsRVFWUjRuR05nQUFBQUFnQUJTSytrY1FBQUFBQkpSVTVFcmtKZ2dnPT0=\x1b\\";
const SIXEL_SEQUENCE = "\x1bPqabc\x1b\\";

type MutableTerminalInfo = { imageProtocol: ImageProtocol | null };
const terminal = TERMINAL as unknown as MutableTerminalInfo;

describe("isImagePassthroughEnabled", () => {
	const original = TERMINAL.imageProtocol;

	afterEach(() => {
		terminal.imageProtocol = original;
	});

	it("returns true when terminal has an image protocol", () => {
		terminal.imageProtocol = ImageProtocol.Iterm2;
		expect(isImagePassthroughEnabled()).toBe(true);
	});

	it("returns true for Kitty protocol", () => {
		terminal.imageProtocol = ImageProtocol.Kitty;
		expect(isImagePassthroughEnabled()).toBe(true);
	});

	it("returns true for Sixel protocol", () => {
		terminal.imageProtocol = ImageProtocol.Sixel;
		expect(isImagePassthroughEnabled()).toBe(true);
	});

	it("returns false when protocol is null", () => {
		terminal.imageProtocol = null;
		expect(isImagePassthroughEnabled()).toBe(false);
	});
});

describe("containsImageSequence", () => {
	it("detects iTerm2 sequences", () => {
		expect(containsImageSequence(ITERM2_SEQUENCE)).toBe(true);
	});

	it("detects Kitty sequences", () => {
		expect(containsImageSequence(KITTY_SEQUENCE)).toBe(true);
	});

	it("detects Sixel sequences", () => {
		expect(containsImageSequence(SIXEL_SEQUENCE)).toBe(true);
	});

	it("detects iTerm2 multipart start", () => {
		expect(containsImageSequence(ITERM2_MULTIPART_START)).toBe(true);
	});

	it("detects iTerm2 FilePart", () => {
		expect(containsImageSequence(ITERM2_FILEPART)).toBe(true);
	});

	it("detects iTerm2 FileEnd", () => {
		expect(containsImageSequence(ITERM2_FILEEND)).toBe(true);
	});

	it("returns false for plain text", () => {
		expect(containsImageSequence("hello world")).toBe(false);
	});

	it("returns false for other ANSI sequences", () => {
		expect(containsImageSequence("\x1b[32mgreen text\x1b[0m")).toBe(false);
	});
});

describe("isImageLine", () => {
	it("recognizes iTerm2 lines", () => {
		expect(isImageLine(ITERM2_SEQUENCE)).toBe(true);
	});

	it("recognizes Kitty lines", () => {
		expect(isImageLine(KITTY_SEQUENCE)).toBe(true);
	});

	it("recognizes Sixel lines", () => {
		expect(isImageLine(SIXEL_SEQUENCE)).toBe(true);
	});

	it("returns false for plain text", () => {
		expect(isImageLine("hello")).toBe(false);
	});
});

describe("getImageLineMask", () => {
	it("marks iTerm2 lines correctly", () => {
		const lines = ["before", ITERM2_SEQUENCE, "after"];
		const mask = getImageLineMask(lines);
		expect(mask).toEqual([false, true, false]);
	});

	it("marks Kitty lines correctly", () => {
		const lines = ["before", KITTY_SEQUENCE, "after"];
		const mask = getImageLineMask(lines);
		expect(mask).toEqual([false, true, false]);
	});

	it("marks Sixel lines correctly", () => {
		const lines = ["line1", SIXEL_SEQUENCE, "line2"];
		const mask = getImageLineMask(lines);
		expect(mask).toEqual([false, true, false]);
	});

	it("handles multi-line Sixel sequences", () => {
		// Multi-line Sixel: start and end on different lines
		const lines = ["\x1bPqabc", "more sixel data", "\x1b\\", "after"];
		const mask = getImageLineMask(lines);
		expect(mask[0]).toBe(true);
		expect(mask[1]).toBe(true);
		expect(mask[2]).toBe(true);
		expect(mask[3]).toBe(false);
	});

	it("returns all-false for plain text", () => {
		const lines = ["line1", "line2", "line3"];
		const mask = getImageLineMask(lines);
		expect(mask).toEqual([false, false, false]);
	});

	it("handles empty input", () => {
		expect(getImageLineMask([])).toEqual([]);
	});
});

describe("sanitizeWithImagePassthrough - iTerm2", () => {
	const original = TERMINAL.imageProtocol;

	afterEach(() => {
		terminal.imageProtocol = original;
	});

	it("preserves iTerm2 sequence when protocol is Iterm2", () => {
		terminal.imageProtocol = ImageProtocol.Iterm2;
		const result = sanitizeWithImagePassthrough(ITERM2_SEQUENCE, sanitizeText);
		expect(result).toContain("\x1b]1337;File=");
		expect(result).toContain("\x07");
	});

	it("preserves iTerm2 multipart sequences", () => {
		terminal.imageProtocol = ImageProtocol.Iterm2;
		const multipart = `${ITERM2_MULTIPART_START}\n${ITERM2_FILEPART}\n${ITERM2_FILEPART}\n${ITERM2_FILEEND}`;
		const result = sanitizeWithImagePassthrough(multipart, sanitizeText);
		expect(result).toContain("\x1b]1337;MultipartFile=");
		expect(result).toContain("\x1b]1337;FilePart=");
		expect(result).toContain("\x1b]1337;FileEnd");
	});

	it("preserves iTerm2 sequence when protocol is Kitty (cross-protocol passthrough)", () => {
		// Any protocol being set means passthrough is enabled
		terminal.imageProtocol = ImageProtocol.Kitty;
		const result = sanitizeWithImagePassthrough(ITERM2_SEQUENCE, sanitizeText);
		expect(result).toContain("\x1b]1337;File=");
	});

	it("strips iTerm2 sequence when protocol is null", () => {
		terminal.imageProtocol = null;
		const result = sanitizeWithImagePassthrough(ITERM2_SEQUENCE, sanitizeText);
		expect(result).not.toContain("\x1b]1337;");
	});

	it("strips iTerm2 sequence along with other control chars when protocol is null", () => {
		terminal.imageProtocol = null;
		const mixed = `hello ${ITERM2_SEQUENCE} world`;
		const result = sanitizeWithImagePassthrough(mixed, sanitizeText);
		expect(result).not.toContain("\x1b]1337;");
		expect(result).toContain("hello");
		expect(result).toContain("world");
	});

	it("preserves iTerm2 in mixed output", () => {
		terminal.imageProtocol = ImageProtocol.Iterm2;
		const mixed = `before\n${ITERM2_SEQUENCE}\nafter`;
		const result = sanitizeWithImagePassthrough(mixed, sanitizeText);
		expect(result).toContain("\x1b]1337;File=");
		expect(result).toContain("before");
		expect(result).toContain("after");
	});

	it("handles large iTerm2 payload without regex catastrophe", () => {
		terminal.imageProtocol = ImageProtocol.Iterm2;
		// Large base64 payload (simulates a real image)
		const largeBase64 = "A".repeat(200_000);
		const largeSequence = `\x1b]1337;File=inline=1:${largeBase64}\x07`;
		const start = Date.now();
		const result = sanitizeWithImagePassthrough(largeSequence, sanitizeText);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(1000); // Must complete in under 1s
		expect(result).toContain("\x1b]1337;File=");
	});
});

describe("sanitizeWithImagePassthrough - Kitty", () => {
	const original = TERMINAL.imageProtocol;

	afterEach(() => {
		terminal.imageProtocol = original;
	});

	it("preserves Kitty sequence when protocol is set", () => {
		terminal.imageProtocol = ImageProtocol.Kitty;
		const result = sanitizeWithImagePassthrough(KITTY_SEQUENCE, sanitizeText);
		expect(result).toContain("\x1b_G");
		expect(result).toContain("\x1b\\");
	});

	it("strips Kitty sequence when protocol is null", () => {
		terminal.imageProtocol = null;
		const result = sanitizeWithImagePassthrough(KITTY_SEQUENCE, sanitizeText);
		expect(result).not.toContain("\x1b_G");
	});

	it("handles multi-chunk Kitty sequence (m=1 continuation)", () => {
		terminal.imageProtocol = ImageProtocol.Kitty;
		const chunk1 = "\x1b_Ga=T,f=100,q=2,m=1;AAAA\x1b\\";
		const chunk2 = "\x1b_Gm=1;BBBB\x1b\\";
		const chunk3 = "\x1b_Gm=0;CCCC\x1b\\";
		const multiChunk = chunk1 + chunk2 + chunk3;
		const result = sanitizeWithImagePassthrough(multiChunk, sanitizeText);
		expect(result).toContain("\x1b_G");
	});
});

describe("sanitizeWithImagePassthrough - Sixel backward compat", () => {
	const original = TERMINAL.imageProtocol;

	afterEach(() => {
		terminal.imageProtocol = original;
	});

	it("preserves Sixel sequence when protocol is Sixel", () => {
		terminal.imageProtocol = ImageProtocol.Sixel;
		const result = sanitizeWithImagePassthrough(SIXEL_SEQUENCE, sanitizeText);
		expect(result).toContain("\x1bPq");
		expect(result).toContain("\x1b\\");
	});

	it("strips Sixel sequence when protocol is null", () => {
		terminal.imageProtocol = null;
		const result = sanitizeWithImagePassthrough(SIXEL_SEQUENCE, sanitizeText);
		expect(result).not.toContain("\x1bPq");
	});
});

describe("extractITerm2ImageData", () => {
	it("extracts base64 from single-part File= sequence", () => {
		const result = extractITerm2ImageData(ITERM2_SEQUENCE);
		expect(result).not.toBeNull();
		expect(result!.base64).toContain("aVZCT1J3MEtHZ29B");
		expect(result!.base64).toContain("cmtKZ2dnPT0=");
		expect(result!.mimeType).toBe("image/png");
	});

	it("reassembles base64 from multipart FilePart sequences", () => {
		const multipart = `${ITERM2_MULTIPART_START}${ITERM2_FILEPART}${ITERM2_FILEPART}${ITERM2_FILEEND}`;
		const result = extractITerm2ImageData(multipart);
		expect(result).not.toBeNull();
		expect(result!.base64.length).toBeGreaterThan(0);
		// Two identical parts concatenated
		expect(result!.base64).toContain("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=");
	});

	it("returns null for plain text", () => {
		expect(extractITerm2ImageData("hello world")).toBeNull();
	});

	it("returns null for non-iTerm2 sequences", () => {
		expect(extractITerm2ImageData(SIXEL_SEQUENCE)).toBeNull();
	});

	it("detects PNG mime type from base64 header", () => {
		// iVBOR is the base64 prefix for PNG
		const pngSeq = "\x1b]1337;File=inline=1:iVBORw0KGgo=\x07";
		const result = extractITerm2ImageData(pngSeq);
		expect(result!.mimeType).toBe("image/png");
	});

	it("detects JPEG mime type from base64 header", () => {
		const jpegSeq = "\x1b]1337;File=inline=1:/9j/4AAQ\x07";
		const result = extractITerm2ImageData(jpegSeq);
		expect(result!.mimeType).toBe("image/jpeg");
	});
});
