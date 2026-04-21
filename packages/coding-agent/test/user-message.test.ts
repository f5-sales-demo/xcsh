import { beforeAll, describe, expect, it } from "bun:test";
import { visibleWidth } from "@f5xc-salesdemos/pi-tui";
import { UserMessageComponent } from "@f5xc-salesdemos/xcsh/modes/components/user-message";
import { initTheme, theme } from "@f5xc-salesdemos/xcsh/modes/theme/theme";

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

	it("prefixes every content line with 2-space gutter pad + pi icon or continuation bar", () => {
		// The π / ┃ sit inside the content area (column 2+), not at column 0
		// where GutterBlock indicators (●) render. The leading 2 cols are
		// plain spaces outside the message background.
		const c = new UserMessageComponent("hello world\nsecond line");
		const lines = renderPlain(c);
		expect(lines.length).toBeGreaterThan(1);
		const pi = theme.icon.pi;
		// Line 0 is the leading spacer. Content starts at line 1.
		expect(lines[1].startsWith(`  ${pi} `)).toBe(true);
		for (let i = 2; i < lines.length; i++) {
			expect(lines[i].startsWith(`  ${CONTINUATION_BAR} `)).toBe(true);
		}
	});

	it("leaves the 2-column gutter area unpainted (no bg) on content lines", () => {
		const c = new UserMessageComponent("hello world");
		const raw = c.render(120);
		expect(raw.length).toBeGreaterThan(1);
		const bg = bgPrefix("userMessageBg");
		// The bg must not appear in the first two columns — those cols are
		// reserved for the gutter area that sibling components (GutterBlock)
		// paint indicators into.
		const bgIdx = raw[1].indexOf(bg);
		expect(bgIdx).toBeGreaterThanOrEqual(2);
		// Plain stripped line must start with two literal spaces.
		expect(raw[1].replace(/\x1b\[[0-9;]*m/g, "").startsWith("  ")).toBe(true);
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
