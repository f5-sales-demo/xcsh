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
});
