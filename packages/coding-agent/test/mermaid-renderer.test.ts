import { beforeEach, describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5xc-salesdemos/pi-natives";
import { clearMermaidCache } from "@f5xc-salesdemos/xcsh/modes/theme/mermaid-cache";
import { getThemeByName } from "@f5xc-salesdemos/xcsh/modes/theme/theme";
import { mermaidRenderer } from "@f5xc-salesdemos/xcsh/tools/mermaid-renderer";

const SRC = "graph LR\n A[Login] --> B[Auth]\n B --> C[Home]";

beforeEach(() => clearMermaidCache());

describe("mermaidRenderer.renderResult", () => {
	it("re-renders the diagram from the call args (not the plain result text)", async () => {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const result = { content: [{ type: "text", text: "PLACEHOLDER_SHOULD_NOT_APPEAR" }], isError: false };
		const comp = mermaidRenderer.renderResult(result, { expanded: false, isPartial: false }, theme, { mermaid: SRC });
		const plain = sanitizeText(comp.render(100).join("\n"));
		expect(plain).toContain("Login");
		expect(plain).not.toContain("PLACEHOLDER");
	});

	it("colorizes with a restrained palette (the F5 accent, not a rainbow)", async () => {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const result = { content: [{ type: "text", text: "" }], isError: false };
		const raw = mermaidRenderer
			.renderResult(result, { expanded: false, isPartial: false }, theme, { mermaid: SRC })
			.render(100)
			.join("\n");
		// The single brand accent (arrowheads / frame) is present…
		expect(raw).toContain(theme.getFgAnsi("accent"));
		// …and the diagram is colorized but NOT a rainbow — only a few distinct fg colors.
		const fgColors = new Set(raw.match(/\x1b\[38;2;[0-9;]+m/g) ?? []);
		expect(fgColors.size).toBeGreaterThanOrEqual(2);
		expect(fgColors.size).toBeLessThanOrEqual(5);
	});

	it("renders the full diagram without a '… N more lines' truncation", async () => {
		const theme = (await getThemeByName("xcsh-dark"))!;
		// A tall vertical chain that renders to well over 40 lines.
		const chain = `graph TB\n${Array.from({ length: 18 }, (_, i) => `N${i}[Node ${i}] --> N${i + 1}[Node ${i + 1}]`).join("\n")}`;
		const result = { content: [{ type: "text", text: "" }], isError: false };
		const lines = mermaidRenderer
			.renderResult(result, { expanded: false, isPartial: false }, theme, { mermaid: chain })
			.render(120)
			.join("\n");
		expect(lines).not.toContain("more lines");
		// the last node is present → nothing was cut off the bottom
		expect(sanitizeText(lines)).toContain("Node 18");
	});

	it("renders inside a snug single F5 frame (hugs the diagram, not the full width)", async () => {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const result = { content: [{ type: "text", text: "" }], isError: false };
		const lines = mermaidRenderer
			.renderResult(result, { expanded: false, isPartial: false }, theme, { mermaid: SRC })
			.render(200);
		const plain = sanitizeText(lines.join("\n"));
		// Single F5 frame: top border box on the first line, with the Mermaid + type caption.
		expect(sanitizeText(lines[0]!)).toMatch(/^┌/);
		expect(plain).toContain("Mermaid");
		expect(plain).toContain("flowchart");
		// Rectangular frame: every line is the SAME width…
		const widths = new Set(lines.map(l => Bun.stringWidth(sanitizeText(l))));
		expect(widths.size).toBe(1);
		// …and that width is SNUG (hugs the small diagram), far less than the 200 available.
		const frameWidth = [...widths][0]!;
		expect(frameWidth).toBeLessThan(90);
		expect(frameWidth).toBeGreaterThan(15);
		// no redundant "─── Diagram ───" section bar (header already names the type)
		expect(plain).not.toMatch(/── Diagram ──/);
	});

	it("clips a wide diagram to width without reflowing (row count is width-independent)", async () => {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const wide = "graph LR\n A[Client] --> B[HTTP Load Balancer] --> C[Origin Pool] --> D[Health Check]";
		const make = (w: number) =>
			mermaidRenderer
				.renderResult(
					{ content: [{ type: "text", text: "" }], isError: false },
					{ expanded: false, isPartial: false },
					theme,
					{
						mermaid: wide,
					},
				)
				.render(w);
		const wideRender = make(200);
		const narrowRender = make(40);
		// Clipping (not wrapping) → same number of rows regardless of width.
		expect(narrowRender.length).toBe(wideRender.length);
		// No rendered line exceeds the width (so the terminal never wraps it).
		for (const line of narrowRender) expect(Bun.stringWidth(sanitizeText(line))).toBeLessThanOrEqual(40);
	});
});
