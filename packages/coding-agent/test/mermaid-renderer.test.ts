import { beforeEach, describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5xc-salesdemos/pi-natives";
import { clearMermaidCache } from "@f5xc-salesdemos/xcsh/modes/theme/mermaid-cache";
import { buildNodeAccents } from "@f5xc-salesdemos/xcsh/modes/theme/mermaid-palette";
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

	it("colorizes with per-node accents (not a single flat color)", async () => {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const result = { content: [{ type: "text", text: "" }], isError: false };
		const raw = mermaidRenderer
			.renderResult(result, { expanded: false, isPartial: false }, theme, { mermaid: SRC })
			.render(100)
			.join("\n");
		// At least one node-tint accent is present → the tint pass ran.
		const accents = buildNodeAccents(theme);
		expect(accents.some(a => raw.includes(a))).toBe(true);
		// Many distinct SGR colors, unlike the old flat single-color render.
		const distinct = new Set(raw.match(/\x1b\[[0-9;]*m/g) ?? []);
		expect(distinct.size).toBeGreaterThanOrEqual(6);
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

	it("shows a stand-alone dim caption with no enclosing block frame", async () => {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const result = { content: [{ type: "text", text: "" }], isError: false };
		const plain = sanitizeText(
			mermaidRenderer
				.renderResult(result, { expanded: false, isPartial: false }, theme, { mermaid: SRC })
				.render(100)
				.join("\n"),
		);
		// caption present (lowercase, with the diagram type)
		expect(plain.toLowerCase()).toContain("mermaid");
		expect(plain).toContain("flowchart");
		// NO enclosing F5 output block: neither the "├─ Diagram ─┤" section bar
		// nor the "┌─ Mermaid … ─┐" header box.
		expect(plain).not.toMatch(/─── Diagram ───/);
		expect(plain).not.toMatch(/┌─+ Mermaid/);
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
