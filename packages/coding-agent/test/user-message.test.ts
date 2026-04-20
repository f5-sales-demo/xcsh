import { beforeAll, describe, expect, it } from "bun:test";
import { UserMessageComponent } from "@f5xc-salesdemos/xcsh/modes/components/user-message";
import { initTheme, theme } from "@f5xc-salesdemos/xcsh/modes/theme/theme";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

function stripAnsi(str: string): string {
	// Strip OSC sequences (ESC ] ... BEL) first, then CSI.
	return str.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
}

function renderPlain(component: UserMessageComponent, width = 120): string[] {
	return component.render(width).map(stripAnsi);
}

// Extract the ANSI opening sequence produced by a theme helper, e.g. the
// leading CSI escape returned from `theme.fg("border", "X")`. The helper
// returns `${ansi}X\x1b[39m` (or `\x1b[49m` for bg), so we carve out the
// prefix by slicing off the sentinel and reset.
function fgPrefix(token: Parameters<typeof theme.fg>[0]): string {
	const SENTINEL = "\u0001";
	const wrapped = theme.fg(token, SENTINEL);
	return wrapped.slice(0, wrapped.indexOf(SENTINEL));
}
function bgPrefix(token: Parameters<typeof theme.bg>[0]): string {
	const SENTINEL = "\u0001";
	const wrapped = theme.bg(token, SENTINEL);
	return wrapped.slice(0, wrapped.indexOf(SENTINEL));
}

describe("UserMessageComponent", () => {
	beforeAll(() => {
		initTheme();
	});

	it("prefixes every rendered line with '▌ '", () => {
		const c = new UserMessageComponent("hello world");
		const lines = renderPlain(c);
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			expect(line.startsWith("▌ ")).toBe(true);
		}
	});

	it("has no leading or trailing blank line", () => {
		const c = new UserMessageComponent("hello world");
		const lines = renderPlain(c);
		expect(lines.length).toBeGreaterThan(0);
		// After stripping "▌ " the remainder must have visible content
		// on the first and last line — proves paddingY=0 and no Spacer.
		const first = lines[0].replace(/^▌ /, "").trim();
		const last = lines[lines.length - 1].replace(/^▌ /, "").trim();
		expect(first.length).toBeGreaterThan(0);
		expect(last.length).toBeGreaterThan(0);
	});

	it("renders a single-line message on exactly one rendered line", () => {
		// Proves the Spacer(1) is gone (previously forced 2+ lines for any input).
		const c = new UserMessageComponent("hi");
		expect(renderPlain(c)).toHaveLength(1);
	});

	it("does not paint userMessageBg anywhere", () => {
		const c = new UserMessageComponent("hello world");
		const raw = c.render(120).join("\n");
		const forbidden = bgPrefix("userMessageBg");
		expect(raw.includes(forbidden)).toBe(false);
	});

	it("colours the left bar with the theme's border token", () => {
		const c = new UserMessageComponent("hello world");
		const raw = c.render(120);
		expect(raw.length).toBeGreaterThan(0);
		const borderFg = fgPrefix("border");
		// Every line must open with the border fg sequence wrapping "▌ ".
		// The first line also has the OSC133 start marker prepended —
		// accept either ordering so the test locks behaviour without
		// over-specifying marker placement vs. the bar.
		for (const line of raw) {
			expect(line.includes(`${borderFg}▌ `)).toBe(true);
		}
	});

	it("preserves OSC 133 zone markers on first and last line", () => {
		const c = new UserMessageComponent("line one\nline two");
		const raw = c.render(120);
		expect(raw.length).toBeGreaterThanOrEqual(1);
		// Markers must still surround the message as a whole.
		expect(raw[0].includes(OSC133_ZONE_START)).toBe(true);
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

	it("does not overflow the requested width", () => {
		// Long single token at narrow width — every visible line must fit.
		const longWord = "x".repeat(60);
		const c = new UserMessageComponent(longWord);
		const width = 40;
		const lines = renderPlain(c, width);
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(width);
		}
	});
});
