import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { notebookToolRenderer } from "@f5-sales-demo/xcsh/tools/notebook";
import { getThemeByName } from "../../src/modes/theme/theme";

const GLYPH_REGEX = /[✓✔✗✘⚠ⓘ]/;

describe("notebook renderResult has no terminal status glyph", () => {
	it("edit success renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "Replaced cell 0 (code). Notebook now has 3 cells." }],
			details: {
				action: "edit" as const,
				cellIndex: 0,
				cellType: "code",
				totalCells: 3,
				cellSource: ["print('hi')\n"],
			},
		};
		const component = notebookToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{
				notebook_path: "/tmp/demo.ipynb",
				action: "edit",
				cell_index: 0,
				content: "print('hi')",
			} as never,
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});

	it("error renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "Error: Notebook not found: /tmp/missing.ipynb" }],
			details: undefined,
		};
		const component = notebookToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{
				notebook_path: "/tmp/missing.ipynb",
				action: "edit",
				cell_index: 0,
			} as never,
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});
});
