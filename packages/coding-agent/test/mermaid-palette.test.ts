import { describe, expect, it } from "bun:test";
import { buildMermaidAsciiTheme, buildNodeAccents } from "@f5xc-salesdemos/xcsh/modes/theme/mermaid-palette";
import { getThemeByName } from "@f5xc-salesdemos/xcsh/modes/theme/theme";

const isHex = (s: string): boolean => /^#[0-9a-fA-F]{6}$/.test(s);

describe("Theme.getFgHex", () => {
	it("returns a hex string for a color role", async () => {
		const theme = await getThemeByName("xcsh-dark");
		expect(theme).toBeDefined();
		expect(isHex(theme!.getFgHex("accent"))).toBe(true);
	});

	it("falls back when a role has no hex value", async () => {
		const theme = await getThemeByName("xcsh-dark");
		// `text` resolves to "" (default fg) — must yield the provided fallback.
		expect(theme!.getFgHex("text", "#abcdef")).toBe("#abcdef");
	});
});

describe("buildMermaidAsciiTheme", () => {
	it("maps roles to a multi-hue, all-hex AsciiTheme", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const ascii = buildMermaidAsciiTheme(theme!);
		for (const role of ["fg", "border", "line", "arrow"] as const) {
			expect(isHex(ascii[role] as string)).toBe(true);
		}
		// Multi-hue: borders, edges, and arrows are not all the same color.
		const distinct = new Set([ascii.fg, ascii.border, ascii.line, ascii.arrow]);
		expect(distinct.size).toBeGreaterThanOrEqual(3);
	});

	it("differs between dark and light themes", async () => {
		const dark = buildMermaidAsciiTheme((await getThemeByName("xcsh-dark"))!);
		const light = buildMermaidAsciiTheme((await getThemeByName("xcsh-light"))!);
		expect(JSON.stringify(dark)).not.toBe(JSON.stringify(light));
	});
});

describe("buildNodeAccents", () => {
	it("returns several distinct ANSI foreground escapes", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const accents = buildNodeAccents(theme!);
		expect(accents.length).toBeGreaterThanOrEqual(3);
		// All are SGR foreground sequences.
		for (const a of accents) expect(a).toMatch(/^\x1b\[[0-9;]*m$/);
		// They are distinct.
		expect(new Set(accents).size).toBe(accents.length);
	});
});
