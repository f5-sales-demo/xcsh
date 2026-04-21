import { beforeAll, describe, expect, it } from "bun:test";
import { visibleWidth } from "@f5xc-salesdemos/pi-tui";
import { UserMessageComponent } from "@f5xc-salesdemos/xcsh/modes/components/user-message";
import { initTheme, theme } from "@f5xc-salesdemos/xcsh/modes/theme/theme";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const CONTINUATION_BAR = "┃"; // U+2503 BOX DRAWINGS HEAVY VERTICAL

function stripAnsi(str: string): string {
	return str.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
}

function renderPlain(component: UserMessageComponent, width = 120): string[] {
	return component.render(width).map(stripAnsi);
}

function fgPrefix(token: Parameters<typeof theme.fg>[0]): string {
	const SENTINEL = "";
	const wrapped = theme.fg(token, SENTINEL);
	return wrapped.slice(0, wrapped.indexOf(SENTINEL));
}
function bgPrefix(token: Parameters<typeof theme.bg>[0]): string {
	const SENTINEL = "";
	const wrapped = theme.bg(token, SENTINEL);
	return wrapped.slice(0, wrapped.indexOf(SENTINEL));
}

describe("UserMessageComponent", () => {
	beforeAll(() => {
		initTheme();
	});

	it("prefixes every content line with pi icon or continuation bar", () => {
		const c = new UserMessageComponent("hello world\nsecond line");
		const lines = renderPlain(c);
		expect(lines.length).toBeGreaterThan(1);
		const pi = theme.icon.pi;
		// Line 0 is the leading spacer. Content starts at line 1.
		expect(lines[1].startsWith(`${pi} `)).toBe(true);
		for (let i = 2; i < lines.length; i++) {
			expect(lines[i].startsWith(`${CONTINUATION_BAR} `)).toBe(true);
		}
	});

	it("has a leading blank spacer line", () => {
		const c = new UserMessageComponent("hello world");
		const lines = renderPlain(c);
		expect(lines.length).toBeGreaterThan(1);
		// Line 0 is the spacer (separator from preceding block) — empty.
		expect(lines[0]).toBe("");
		// Line 1 is the first content line — non-empty.
		expect(lines[1].trim().length).toBeGreaterThan(0);
	});

	it("renders a single-line message as spacer + one content line", () => {
		const c = new UserMessageComponent("hi");
		expect(renderPlain(c)).toHaveLength(2);
	});

	it("paints userMessageBg on every content line", () => {
		const c = new UserMessageComponent("hello world\nanother line");
		const raw = c.render(120);
		expect(raw.length).toBeGreaterThan(1);
		const bg = bgPrefix("userMessageBg");
		// Spacer line (raw[0]) must NOT carry the bg.
		expect(raw[0].includes(bg)).toBe(false);
		// Every content line MUST carry the bg.
		for (let i = 1; i < raw.length; i++) {
			expect(raw[i].includes(bg)).toBe(true);
		}
	});

	it("uses pi icon on first content line and heavy bar on continuations, both in border color", () => {
		const c = new UserMessageComponent("line one\nline two");
		const raw = c.render(120);
		const borderFg = fgPrefix("border");
		const pi = theme.icon.pi;
		expect(raw.length).toBeGreaterThan(2); // spacer + >=2 content lines
		// First content line carries border-coloured pi.
		expect(raw[1].includes(`${borderFg}${pi} `)).toBe(true);
		// Subsequent content lines carry the heavy vertical bar in border colour.
		for (let i = 2; i < raw.length; i++) {
			expect(raw[i].includes(`${borderFg}${CONTINUATION_BAR} `)).toBe(true);
		}
	});

	it("preserves OSC 133 zone markers on first and last line", () => {
		const c = new UserMessageComponent("line one\nline two");
		const raw = c.render(120);
		expect(raw.length).toBeGreaterThanOrEqual(2);
		// Spacer does NOT carry markers.
		expect(raw[0].includes(OSC133_ZONE_START)).toBe(false);
		// First content line carries the start marker.
		expect(raw[1].includes(OSC133_ZONE_START)).toBe(true);
		// Last line ends with the end + final markers.
		expect(raw[raw.length - 1].endsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)).toBe(true);
	});

	it("uses dim fg for synthetic messages and not userMessageText", () => {
		const synthetic = new UserMessageComponent("synthetic entry", true);
		const raw = synthetic.render(120).join("\n");
		expect(raw.includes(fgPrefix("dim"))).toBe(true);

		const real = new UserMessageComponent("real entry", false);
		const rawReal = real.render(120).join("\n");
		expect(rawReal.includes(fgPrefix("dim"))).toBe(false);
	});

	it("does not overflow the requested width in terminal columns", () => {
		const longWord = "x".repeat(60);
		const c = new UserMessageComponent(longWord);
		const width = 40;
		const lines = renderPlain(c, width);
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			// Compare terminal columns, not JS code-unit length — the
			// contract is based on visibleWidth which counts wide glyphs
			// (CJK, Nerd Font PUA) as 2 cells.
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("background extends to the full requested width on every content line", () => {
		const c = new UserMessageComponent("short");
		const width = 80;
		const lines = renderPlain(c, width);
		expect(lines.length).toBeGreaterThan(1);
		for (let i = 1; i < lines.length; i++) {
			expect(visibleWidth(lines[i])).toBe(width);
		}
	});

	it("bails out with empty output when width cannot fit prefix + markdown minimum", () => {
		// prefix (<=2 cols) + MIN_MARKDOWN_WIDTH (3) = minimum 5 cols. Any
		// narrower and the contract of not-overflowing cannot be met —
		// verify we return [] rather than emitting oversized lines.
		const c = new UserMessageComponent("hi");
		for (const w of [0, 1, 2, 3, 4]) {
			expect(c.render(w)).toEqual([]);
		}
	});

	it("leading spacer line is completely unstyled (no bg, no fg)", () => {
		const c = new UserMessageComponent("hello world");
		const raw = c.render(120);
		expect(raw.length).toBeGreaterThan(1);
		expect(raw[0]).toBe("");
	});
});
