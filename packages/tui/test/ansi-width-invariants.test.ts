import { describe, expect, it } from "bun:test";
import { padding, sliceByColumn, truncateToWidth, visibleWidth } from "@f5-sales-demo/pi-tui";

// Spec §6.3 names bound to existing utils.ts implementations.
const visualWidth = visibleWidth;
const sliceByColumns = (s: string, columns: number) => sliceByColumn(s, 0, columns);
const padToColumns = (s: string, columns: number) => {
	const w = visibleWidth(s);
	if (w >= columns) return s;
	return s + padding(columns - w);
};

describe("visualWidth (spec §6.3) — counts visible columns", () => {
	it("counts ASCII printable characters as 1 column each", () => {
		expect(visualWidth("hello")).toBe(5);
	});

	it("counts wide (CJK) characters as 2 columns", () => {
		// "日本" = 2 CJK graphemes, each 2 cols wide
		expect(visualWidth("日本")).toBe(4);
	});

	it("ignores SGR (ANSI color) escape sequences", () => {
		// red "abc" via SGR 31 / reset via 0
		const red = "\x1b[31mabc\x1b[0m";
		expect(visualWidth(red)).toBe(3);
	});

	it("counts emoji as their terminal-visible width", () => {
		// Common emoji render as 2 columns. Bun.stringWidth handles this.
		expect(visualWidth("🙂")).toBe(2);
	});

	it("counts the empty string as 0", () => {
		expect(visualWidth("")).toBe(0);
	});
});

describe("sliceByColumns (spec §6.3) — ANSI-aware slice", () => {
	it("slices plain ASCII at a column boundary", () => {
		expect(sliceByColumns("abcdef", 3)).toBe("abc");
	});

	it("preserves SGR state inside the slice", () => {
		// Ask for 3 cols of red "abcdef": output must contain the SGR
		// opener so the slice renders in red, and must close any open SGR
		// at the boundary so callers can safely concatenate.
		const red = "\x1b[31mabcdef\x1b[0m";
		const out = sliceByColumns(red, 3);
		expect(out).toContain("\x1b[31m"); // opening SGR retained
		expect(visualWidth(out)).toBe(3);
	});

	it("does not include content past the requested column count", () => {
		// Cumulative visible width of `out` is exactly 3 cells; no 'd' leaks.
		const out = sliceByColumns("abcdef", 3);
		// The returned text's visible content is "abc". Appending "Z" and
		// re-measuring proves no hidden-visible char snuck in.
		expect(visualWidth(`${out}Z`)).toBe(4);
	});

	it("returns empty text for a zero-column request", () => {
		expect(sliceByColumns("abc", 0)).toBe("");
	});
});

describe("padToColumns (spec §6.3) — append unstyled spaces", () => {
	it("appends spaces to reach the requested column count", () => {
		const out = padToColumns("ab", 5);
		expect(out).toBe("ab   ");
		expect(visualWidth(out)).toBe(5);
	});

	it("returns the input unchanged when already at the requested width", () => {
		expect(padToColumns("abcde", 5)).toBe("abcde");
	});

	it("returns the input unchanged when wider than requested (no truncation)", () => {
		// padToColumns only pads; truncation is a different operation.
		expect(padToColumns("abcdef", 3)).toBe("abcdef");
	});

	it("pads correctly after SGR-styled input without extending the style", () => {
		const input = "\x1b[32mab\x1b[0m";
		const out = padToColumns(input, 5);
		// The appended spaces come AFTER the reset — they are unstyled.
		// visibleWidth is 5 because the styled "ab" is 2 cols + 3 pad spaces.
		expect(visualWidth(out)).toBe(5);
		// Sanity: the trailing characters of `out` are exactly three spaces.
		expect(out.endsWith("   ")).toBe(true);
	});
});

describe("truncateToWidth with pad=true (used by HorizontalSplit in Task 7)", () => {
	it("truncates and pads to exactly the requested width", () => {
		expect(visualWidth(truncateToWidth("abcdefghij", 5, null, true))).toBe(5);
	});

	it("pads a short input to the requested width", () => {
		const out = truncateToWidth("ab", 5, null, true);
		expect(visualWidth(out)).toBe(5);
	});
});
