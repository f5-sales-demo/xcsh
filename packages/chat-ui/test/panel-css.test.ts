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

	test("constrains message width so long content wraps instead of overflowing the pane", () => {
		// The gutter-grid content column must be allowed to shrink (min-width:0) or a
		// long unbreakable token pushes it past the pane's right edge (issue #2271).
		expect(PANEL_CSS).toMatch(/\.content\s*\{[^}]*min-width:\s*0/);
		// And the markdown body must break long tokens/URLs.
		expect(PANEL_CSS).toMatch(/\.markdown-root\s*\{[^}]*overflow-wrap:\s*anywhere/);
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

describe("Claude-parity shell chrome", () => {
	test("the brand block is a top-anchored layer (not the centered empty state)", () => {
		expect(PANEL_CSS).toContain(".brand-block");
		// Must NOT centre like .empty-state — it sits at the top of the scrollport.
		expect(PANEL_CSS).not.toMatch(/\.brand-block\s*\{[^}]*justify-content:\s*center/);
	});

	test("the pinned control row has no divider (Claude has no rule under the brand)", () => {
		expect(PANEL_CSS).not.toMatch(/^\.header\s*\{[^}]*border-bottom/m);
	});

	test("the Office host reserves right padding so the row clears Office's own i button", () => {
		expect(PANEL_CSS).toMatch(/\.xcsh-host-office\s+\.header\s*\{[^}]*padding-right/);
	});

	test("icon buttons carry a CSS tooltip driven by data-tip, hidden by default", () => {
		expect(PANEL_CSS).toMatch(/\.header-btn\[data-tip\]::after\s*\{[^}]*content:\s*attr\(data-tip\)/);
		expect(PANEL_CSS).toMatch(/\.header-btn\[data-tip\]::after\s*\{[^}]*opacity:\s*0/);
		expect(PANEL_CSS).toMatch(/\.header-btn\[data-tip\]:hover::after/);
		expect(PANEL_CSS).toMatch(/\.header-btn\[data-tip\]:focus-visible::after/);
		// Respect reduced-motion (no fade/delay for users who ask for less motion).
		expect(PANEL_CSS).toMatch(/prefers-reduced-motion/);
	});

	test("stacked pills read as Claude's vertical slash-command list", () => {
		expect(PANEL_CSS).toMatch(/\.pills\.pills-stacked\s*\{[^}]*flex-direction:\s*column/);
	});

	test("the retired bespoke office header + floating settings button are gone", () => {
		expect(PANEL_CSS).not.toContain(".header-new-chat");
		expect(PANEL_CSS).not.toContain(".gateway-settings-btn");
	});
});
