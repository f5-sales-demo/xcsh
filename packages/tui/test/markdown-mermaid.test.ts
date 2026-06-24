import { describe, expect, it } from "bun:test";
import { Markdown } from "../src/components/markdown.js";
import { defaultMarkdownTheme } from "./test-themes.js";

// A prerendered, colored diagram (cyan box) as the mermaid cache would return.
const CYAN = "\x1b[38;2;0;180;255m";
const COLORED = [`${CYAN}┌──┐\x1b[0m`, `${CYAN}│A │\x1b[0m`, `${CYAN}└──┘\x1b[0m`].join("\n");

describe("Markdown mermaid block", () => {
	it("retains ANSI color from the prerendered diagram (does not strip)", () => {
		const theme = { ...defaultMarkdownTheme, getMermaidAscii: () => COLORED };
		const md = new Markdown("```mermaid\ngraph LR\n A --> B\n```", 0, 0, theme);
		const out = md.render(80).join("\n");
		expect(out).toContain(CYAN); // color preserved, not stripped
		expect(out).toContain("┌──┐"); // diagram geometry rendered
	});

	it("clips (does not reflow) a wide inline mermaid diagram to the render width", () => {
		const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
		// A 3-row diagram far wider than the render width.
		const wide = [`┌${"─".repeat(200)}┐`, `│ Node${" ".repeat(195)}│`, `└${"─".repeat(200)}┘`].join("\n");
		const theme = { ...defaultMarkdownTheme, getMermaidAscii: () => wide };
		const md = new Markdown("```mermaid\ngraph LR\n A --> B\n```", 0, 0, theme);
		const W = 40;
		const lines = md.render(W);
		// CLIP, not WRAP: a 3-row diagram must stay ~3 rows, not balloon (word-wrap → ~14).
		expect(lines.length).toBeLessThanOrEqual(5);
		// And no line exceeds the width.
		for (const line of lines) expect(Bun.stringWidth(strip(line))).toBeLessThanOrEqual(W);
	});

	it("frames an inline mermaid block when renderMermaidBlock is provided", () => {
		const framed = ["┌─ Mermaid · flowchart ─┐", "│ A --> B               │", "└───────────────────────┘"];
		const theme = { ...defaultMarkdownTheme, renderMermaidBlock: () => framed };
		const md = new Markdown("```mermaid\ngraph LR\n A --> B\n```", 0, 0, theme);
		const out = md.render(40).join("\n");
		expect(out).toContain("Mermaid · flowchart");
		expect(out).toContain("┌─ Mermaid");
	});
});
