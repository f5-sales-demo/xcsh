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
	it("maps roles to a restrained all-hex palette (neutral structure + one accent)", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const ascii = buildMermaidAsciiTheme(theme!);
		for (const role of ["fg", "border", "line", "arrow"] as const) {
			expect(isHex(ascii[role] as string)).toBe(true);
		}
		// Professional, not rainbow: the arrow is the single accent and stands out from
		// the neutral structure; edges recede behind the labels.
		expect(ascii.arrow).not.toBe(ascii.border);
		expect(ascii.line).not.toBe(ascii.fg);
	});

	it("differs between dark and light themes", async () => {
		const dark = buildMermaidAsciiTheme((await getThemeByName("xcsh-dark"))!);
		const light = buildMermaidAsciiTheme((await getThemeByName("xcsh-light"))!);
		expect(JSON.stringify(dark)).not.toBe(JSON.stringify(light));
	});
});

describe("buildNodeAccents", () => {
	it("returns no per-node accents (uniform, non-rainbow nodes)", async () => {
		const theme = await getThemeByName("xcsh-dark");
		expect(buildNodeAccents(theme!)).toEqual([]);
	});
});
