/**
 * Functionality matrix for F5 XC mermaid rendering: every sample diagram across
 * every theme × colorMode × (unicode|ascii). Guards the colorized rendering and
 * its invariants against regression; the visual counterpart is
 * scripts/mermaid-gallery.ts (run for human UAT).
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { clearMermaidCache, renderMermaidThemed } from "@f5xc-salesdemos/xcsh/modes/theme/mermaid-cache";
import { getThemeByName, type Theme } from "@f5xc-salesdemos/xcsh/modes/theme/theme";
import { XC_MERMAID_SAMPLES } from "./fixtures/xc-mermaid-samples";

const MODES = ["none", "ansi256", "truecolor"] as const;
const THEME_NAMES = ["xcsh-dark", "xcsh-light"] as const;
const hasEsc = (s: string): boolean => /\x1b\[/.test(s);
const UNICODE_BOX = /[┌┐└┘─│├┤┬┴┼╭╮╰╯]/;

let themes: Record<string, Theme>;

beforeAll(async () => {
	themes = {
		"xcsh-dark": (await getThemeByName("xcsh-dark"))!,
		"xcsh-light": (await getThemeByName("xcsh-light"))!,
	};
});
beforeEach(() => clearMermaidCache());

describe("XC mermaid sample library", () => {
	it("contains several dozen samples across every diagram type", () => {
		expect(XC_MERMAID_SAMPLES.length).toBeGreaterThanOrEqual(24);
		const types = new Set(XC_MERMAID_SAMPLES.map(s => s.type));
		for (const t of ["flowchart", "sequence", "class", "er", "state", "xychart"]) {
			expect(types.has(t as never)).toBe(true);
		}
		// ids are unique
		expect(new Set(XC_MERMAID_SAMPLES.map(s => s.id)).size).toBe(XC_MERMAID_SAMPLES.length);
	});
});

describe("full render matrix (samples × themes × colorModes × ascii)", () => {
	it("every cell renders to non-empty output", () => {
		const failures: string[] = [];
		for (const s of XC_MERMAID_SAMPLES) {
			for (const tn of THEME_NAMES) {
				for (const mode of MODES) {
					for (const useAscii of [false, true]) {
						const out = renderMermaidThemed(s.source, themes[tn]!, { colorMode: mode, render: { useAscii } });
						if (out == null || out.trim() === "") failures.push(`${s.id} [${tn}/${mode}/ascii=${useAscii}]`);
					}
				}
			}
		}
		expect(failures).toEqual([]);
	});
});

describe("per-sample invariants (xcsh-dark)", () => {
	for (const s of XC_MERMAID_SAMPLES) {
		it(`${s.type}: ${s.id}`, () => {
			const theme = themes["xcsh-dark"]!;

			// colorMode none → plain text, zero escapes.
			const none = renderMermaidThemed(s.source, theme, { colorMode: "none" })!;
			expect(none).toBeTruthy();
			expect(hasEsc(none)).toBe(false);

			// truecolor → colorized, and stripping color reproduces the plain geometry.
			const tc = renderMermaidThemed(s.source, theme, { colorMode: "truecolor" })!;
			expect(hasEsc(tc)).toBe(true);
			expect(Bun.stripANSI(tc)).toBe(none);

			// Render options must affect output (and the cache key): ASCII mode emits
			// no Unicode box-drawing characters for box-shaped diagrams.
			const ascii = renderMermaidThemed(s.source, theme, { colorMode: "none", render: { useAscii: true } })!;
			if (UNICODE_BOX.test(none)) expect(UNICODE_BOX.test(ascii)).toBe(false);
		});
	}
});
