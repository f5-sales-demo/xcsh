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

	it("shows a diagram-type caption and the tool title", async () => {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const result = { content: [{ type: "text", text: "" }], isError: false };
		const plain = sanitizeText(
			mermaidRenderer
				.renderResult(result, { expanded: false, isPartial: false }, theme, { mermaid: SRC })
				.render(100)
				.join("\n"),
		);
		expect(plain).toContain("Mermaid");
		expect(plain.toLowerCase()).toContain("flowchart");
	});
});
