/**
 * Presence probes for the two stylesheet layers this feature adds:
 *  - `.markdown-root` — the block model that styles the semantic HTML the marked
 *    renderer emits (bordered aligned tables, heading scale, nested lists, task
 *    checkboxes, code/pre + language chip, blockquote, hr, del, paragraph rhythm);
 *  - `.xcsh-doc` — the opt-in proportional-sans DOCUMENT surface (Office pane)
 *    that switches prose to `--font-sans` + the type/measure/rhythm tokens while
 *    keeping code monospaced and leaving terminal surfaces untouched.
 *
 * String probes (not a full CSS parse) — enough to gate that the rules exist and
 * remain token-driven; the Puppeteer layer asserts the COMPUTED result.
 */
import { describe, expect, test } from "bun:test";
import { PANEL_CSS } from "../src/theme/panel.css";

describe(".markdown-root block model", () => {
	test("scopes a markdown-root block layer", () => {
		expect(PANEL_CSS).toContain(".markdown-root");
	});

	test("tables are bordered and alignment classes map to text-align", () => {
		expect(PANEL_CSS).toContain(".markdown-root table");
		expect(PANEL_CSS).toMatch(/\.markdown-root (th|td)[^{]*\{[^}]*border/);
		expect(PANEL_CSS).toContain(".md-align-left { text-align: left; }");
		expect(PANEL_CSS).toContain(".md-align-center { text-align: center; }");
		expect(PANEL_CSS).toContain(".md-align-right { text-align: right; }");
	});

	test("carries heading, list, blockquote, hr, task-checkbox, and code-chip rules", () => {
		expect(PANEL_CSS).toContain(".markdown-root h1");
		expect(PANEL_CSS).toContain(".markdown-root ul");
		expect(PANEL_CSS).toContain(".markdown-root blockquote");
		expect(PANEL_CSS).toContain(".markdown-root hr");
		expect(PANEL_CSS).toContain(".markdown-root pre");
		expect(PANEL_CSS).toContain(".md-lang-label");
		expect(PANEL_CSS).toContain('input[type="checkbox"]');
	});
});

describe(".xcsh-doc document surface", () => {
	test("switches the pane to the sans document typography via tokens", () => {
		expect(PANEL_CSS).toContain(".xcsh-doc");
		expect(PANEL_CSS).toContain("var(--font-sans)");
		expect(PANEL_CSS).toContain("var(--text-base)");
		expect(PANEL_CSS).toContain("var(--leading-relaxed)");
	});

	test("constrains the measure and keeps code monospaced", () => {
		expect(PANEL_CSS).toContain("var(--measure");
		expect(PANEL_CSS).toMatch(/\.xcsh-doc[^{]*(code|pre)[^{]*\{[^}]*var\(--font-mono\)/);
	});
});
