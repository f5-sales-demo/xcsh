import { describe, expect, it } from "bun:test";
import { MAX_ERROR_MESSAGE_WIDTH, sanitizeErrorMessage } from "../src/modes/utils/sanitize-error-message";

describe("sanitizeErrorMessage", () => {
	it("passes plain single-line messages through unchanged", () => {
		expect(sanitizeErrorMessage("command not found")).toBe("command not found");
	});

	it("collapses embedded newlines to a single space", () => {
		expect(sanitizeErrorMessage("line one\nline two\nline three")).toBe("line one line two line three");
	});

	it("collapses tabs and CR to a single space", () => {
		expect(sanitizeErrorMessage("a\tb\r\nc")).toBe("a b c");
	});

	it("strips ASCII control characters except already-handled whitespace", () => {
		// BEL, ESC, NUL, DEL must not survive
		expect(sanitizeErrorMessage("bad\x07\x1b\x00\x7fword")).toBe("badword");
	});

	it("collapses runs of whitespace to a single space and trims", () => {
		expect(sanitizeErrorMessage("   a     b   ")).toBe("a b");
	});

	it("truncates long messages at MAX_ERROR_MESSAGE_WIDTH with an ellipsis", () => {
		const input = "x".repeat(MAX_ERROR_MESSAGE_WIDTH + 100);
		const out = sanitizeErrorMessage(input);
		expect(out.length).toBe(MAX_ERROR_MESSAGE_WIDTH);
		expect(out.endsWith("…")).toBe(true);
		expect(out.slice(0, MAX_ERROR_MESSAGE_WIDTH - 1)).toBe("x".repeat(MAX_ERROR_MESSAGE_WIDTH - 1));
	});

	it("handles empty and whitespace-only input", () => {
		expect(sanitizeErrorMessage("")).toBe("");
		expect(sanitizeErrorMessage("   \n\t  ")).toBe("");
	});

	it("preserves non-ASCII printable characters (unicode symbols, accents)", () => {
		expect(sanitizeErrorMessage("café — ü ★")).toBe("café — ü ★");
	});

	it("strips full ANSI CSI escape sequences (colored error output)", () => {
		// A subprocess returning `\x1b[31mboom\x1b[0m` must not leave
		// `[31mboom[0m` garbage in the footer.
		expect(sanitizeErrorMessage("\x1b[31mboom\x1b[0m")).toBe("boom");
	});

	it("strips ANSI SGR sequences with multiple parameters", () => {
		expect(sanitizeErrorMessage("prefix \x1b[1;31;40merror\x1b[0m suffix")).toBe("prefix error suffix");
	});

	it("strips OSC escape sequences (terminal titles, hyperlinks)", () => {
		// OSC 8 (hyperlink) and OSC terminators must be removed.
		expect(sanitizeErrorMessage("pre \x1b]8;;http://x.y\x1b\\label\x1b]8;;\x1b\\ post")).toBe("pre label post");
	});

	it("truncation width stays well inside an 80-column terminal with the footer wrapper", () => {
		// `(error: <msg>)` adds 9 chars of wrapper. A typical terminal is 80
		// columns. Guarantee the sanitized message plus wrapper stays under
		// 80 so the footer renders on a single line.
		expect(MAX_ERROR_MESSAGE_WIDTH + 9).toBeLessThanOrEqual(80);
	});

	it("truncation measures in terminal cells, not UTF-16 code units (CJK)", async () => {
		// CJK glyphs render as 2 cells but are 1 UTF-16 code unit each. If we
		// truncated by .length we would emit up to MAX_ERROR_MESSAGE_WIDTH
		// glyphs = 2*MAX cells, overflowing the 80-col target. The sanitizer
		// must use display-width truncation.
		const { visibleWidth } = await import("@f5-sales-demo/pi-tui");
		const cjk = "漢".repeat(100); // 100 code units, 200 cells
		const out = sanitizeErrorMessage(cjk);
		expect(visibleWidth(out)).toBeLessThanOrEqual(MAX_ERROR_MESSAGE_WIDTH);
	});

	it("truncation preserves narrow ASCII up to the budget", async () => {
		const { visibleWidth } = await import("@f5-sales-demo/pi-tui");
		const out = sanitizeErrorMessage("x".repeat(MAX_ERROR_MESSAGE_WIDTH + 50));
		expect(visibleWidth(out)).toBeLessThanOrEqual(MAX_ERROR_MESSAGE_WIDTH);
		expect(out.endsWith("…")).toBe(true);
	});
});
