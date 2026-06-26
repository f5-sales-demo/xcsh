import { beforeAll, describe, expect, it } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { UserMessageComponent } from "@f5-sales-demo/xcsh/modes/components/user-message";
import { initTheme, theme } from "@f5-sales-demo/xcsh/modes/theme/theme";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const CONTINUATION_BAR = "┃"; // U+2503 BOX DRAWINGS HEAVY VERTICAL
const ITALIC_ON = "\x1b[3m";
const ITALIC_OFF = "\x1b[23m";

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

	it("puts pi icon in gutter on first line and continuation bar in content area on every line, with exactly one space between bar and text", () => {
		// After the gutter/content separation:
		//   col 0-1 (gutter, unpainted): π on first content line, "  " on continuations
		//   col 2+ (userMessageBg painted): ┃ + one space + markdown content on every line
		// The single space between ┃ and text is critical — a double-space would
		// indicate Markdown's paddingX is still contributing a stray leading col.
		const c = new UserMessageComponent("hello world\nsecond line");
		const lines = renderPlain(c);
		expect(lines.length).toBeGreaterThan(1);
		const pi = theme.icon.pi;
		// Line 0 is the leading spacer. Content starts at line 1.
		// Pin the full prefix including the first text char so a stray space
		// between ┃ and text would break startsWith.
		expect(lines[1].startsWith(`${pi} ${CONTINUATION_BAR} hello world`)).toBe(true);
		// Continuation line: two gutter spaces, ┃, one space, text.
		expect(lines[2].startsWith(`  ${CONTINUATION_BAR} second line`)).toBe(true);
	});

	it("leaves the 2-column gutter area unpainted (no bg) on every content line", () => {
		// userMessageBg still starts at col >= 2 on every content line — the gutter
		// stays outside the painted region. What lives IN the gutter differs by
		// line: π on the first content line, two spaces on continuations.
		const c = new UserMessageComponent("hello world\nsecond line");
		const raw = c.render(120);
		expect(raw.length).toBeGreaterThan(2);
		const bg = bgPrefix("userMessageBg");
		const pi = theme.icon.pi;
		// First content line: bg starts after π + space, and the stripped line
		// begins with the π glyph (not two spaces — π IS the gutter content).
		const bgIdxFirst = raw[1].indexOf(bg);
		expect(bgIdxFirst).toBeGreaterThanOrEqual(2);
		expect(raw[1].replace(/\x1b\[[0-9;]*m/g, "").startsWith(`${pi} `)).toBe(true);
		// Continuation line: bg starts after two literal spaces, and the stripped
		// line begins with those two spaces.
		const bgIdxCont = raw[2].indexOf(bg);
		expect(bgIdxCont).toBeGreaterThanOrEqual(2);
		expect(raw[2].replace(/\x1b\[[0-9;]*m/g, "").startsWith("  ")).toBe(true);
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

	it("renders border-coloured pi in the gutter on line 1 and border-coloured heavy bar in content on every line", () => {
		// The π icon now lives in the gutter (outside userMessageBg) only on the
		// first content line. The ┃ accent bar lives in the content area (inside
		// userMessageBg) on every content line including the first. Both use
		// border fg.
		const c = new UserMessageComponent("line one\nline two");
		const raw = c.render(120);
		const borderFg = fgPrefix("border");
		const bg = bgPrefix("userMessageBg");
		const pi = theme.icon.pi;
		expect(raw.length).toBeGreaterThan(2); // spacer + >=2 content lines
		// First content line: border-coloured π appears BEFORE the userMessageBg
		// escape (i.e., it's in the gutter, outside the painted region). The
		// border-coloured ┃ appears AFTER the bg escape (inside the painted region).
		const line1PiIdx = raw[1].indexOf(`${borderFg}${pi} `);
		const line1BgIdx = raw[1].indexOf(bg);
		const line1BarIdx = raw[1].indexOf(`${borderFg}${CONTINUATION_BAR} `);
		expect(line1PiIdx).toBeGreaterThanOrEqual(0);
		expect(line1BgIdx).toBeGreaterThan(line1PiIdx);
		expect(line1BarIdx).toBeGreaterThan(line1BgIdx);
		// Continuation lines: border-coloured ┃ is present, π is not.
		for (let i = 2; i < raw.length; i++) {
			expect(raw[i].includes(`${borderFg}${CONTINUATION_BAR} `)).toBe(true);
			expect(raw[i].includes(pi)).toBe(false);
		}
	});

	it("does not emit OSC 133 semantic prompt markers on any line", () => {
		// OSC 133 markers belong on the live input editor, not historical
		// transcript entries. iTerm2 renders a shell-integration triangle in
		// the left margin for every zone, which is noise in the scrollback.
		const c = new UserMessageComponent("line one\nline two");
		const raw = c.render(120);
		expect(raw.length).toBeGreaterThanOrEqual(2);
		for (const line of raw) {
			expect(line.includes(OSC133_ZONE_START)).toBe(false);
			expect(line.includes(OSC133_ZONE_END)).toBe(false);
			expect(line.includes(OSC133_ZONE_FINAL)).toBe(false);
		}
	});

	it("renders non-synthetic user message text in italic", () => {
		const c = new UserMessageComponent("italicize me");
		const raw = c.render(120).join("\n");
		expect(raw.includes(ITALIC_ON)).toBe(true);
		expect(raw.includes(ITALIC_OFF)).toBe(true);
	});

	it("does not italicize synthetic messages", () => {
		const c = new UserMessageComponent("synthetic entry", true);
		const raw = c.render(120).join("\n");
		expect(raw.includes(ITALIC_ON)).toBe(false);
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

	it("bails out with empty output when width cannot fit gutter + prefix + markdown minimum", () => {
		// gutter pad (2) + prefix (≤2 cols, theme-dependent: 1 for Unicode π,
		// 2 for Nerd Font glyph or ASCII "pi") + MIN_MARKDOWN_WIDTH (3) =
		// up to 7 cols. At widths below that upper bound the not-overflowing
		// contract cannot be guaranteed — verify we return [] rather than
		// emitting oversized lines.
		const c = new UserMessageComponent("hi");
		for (const w of [0, 1, 2, 3, 4, 5, 6]) {
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
