import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { COLORS, cssVars, FONT_FACES, FONT_STACK, fontFaceCss, GLYPHS, injectFontFaces, injectTokens } from "../src";

const PKG_DIR = path.resolve(import.meta.dir, "..");

describe("COLORS (generated from xcsh-dark.json)", () => {
	test("canonical F5 red is #ca260a", () => {
		expect(COLORS.f5Red).toBe("#ca260a");
	});

	test("carries the terminal palette (charcoal/deepCharcoal/f5DarkRed + promoted chromeAccent/dim)", () => {
		expect(COLORS.charcoal).toBe("#151820");
		expect(COLORS.deepCharcoal).toBe("#0f1216");
		expect(COLORS.f5DarkRed).toBe("#8a1a07");
		expect(COLORS.chromeAccent).toBe("#00b4ff");
		expect(COLORS.dim).toBe("#6b7280");
	});

	test("every value is a hex color", () => {
		for (const [k, v] of Object.entries(COLORS)) {
			expect(v, `${k}`).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});
});

describe("gen-tokens drift guard", () => {
	test("committed colors.generated.ts is in sync with xcsh-dark.json (--check exits 0)", () => {
		const r = spawnSync("bun", ["scripts/gen-tokens.ts", "--check"], { cwd: PKG_DIR, encoding: "utf8" });
		expect(r.stderr + r.stdout).toContain("up to date");
		expect(r.status).toBe(0);
	});
});

describe("GLYPHS", () => {
	test("terminal glyphs are present", () => {
		expect(GLYPHS.assistant).toBe("●");
		expect(GLYPHS.thinking).toBe("✻");
		expect(GLYPHS.userGutter).toBe("π");
		expect(GLYPHS.prompt).toBe("❯");
		expect(GLYPHS.thinkingLevels).toHaveLength(5);
	});
});

describe("cssVars", () => {
	test("emits a :root block with kebab custom props + metrics", () => {
		const css = cssVars();
		expect(css).toStartWith(":root {");
		expect(css).toContain("--f5-red: #ca260a;");
		expect(css).toContain("--deep-charcoal: #0f1216;");
		expect(css).toContain(`--font-mono: ${FONT_STACK};`);
		expect(css).toContain("--gutter: 2ch;");
	});
});

describe("fontFaceCss", () => {
	test("registers all four MesloLGS NF weights via the injected resolver", () => {
		const css = fontFaceCss(p => `RESOLVED/${p}`);
		expect(FONT_FACES).toHaveLength(4);
		expect((css.match(/@font-face/g) ?? []).length).toBe(4);
		expect(css).toContain("font-family: 'MesloLGS NF'");
		expect(css).toContain("url('RESOLVED/fonts/MesloLGS-NF-Regular.ttf')");
	});

	test("default resolver is identity (no host global touched)", () => {
		expect(fontFaceCss()).toContain("url('fonts/MesloLGS-NF-Regular.ttf')");
	});
});

describe("injectTokens / injectFontFaces (idempotent DOM insertion)", () => {
	test("injectTokens inserts #xcsh-tokens once", () => {
		injectTokens(document);
		injectTokens(document);
		expect(document.querySelectorAll("#xcsh-tokens")).toHaveLength(1);
		expect(document.getElementById("xcsh-tokens")?.textContent).toContain("--f5-red: #ca260a;");
	});

	test("injectFontFaces inserts #xcsh-fontface once", () => {
		injectFontFaces(document);
		injectFontFaces(document);
		expect(document.querySelectorAll("#xcsh-fontface")).toHaveLength(1);
	});
});
