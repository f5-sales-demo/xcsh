import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { getThemeByName } from "@f5-sales-demo/xcsh/modes/theme/theme";
import { vimToolRenderer } from "@f5-sales-demo/xcsh/tools/vim";

const GLYPH_REGEX = /[✓✔✗✘⚠ⓘ]/;

function buildDetails() {
	return {
		file: "sample.ts",
		mode: "NORMAL" as const,
		cursor: { line: 1, col: 1 },
		totalLines: 2,
		modified: false,
		viewport: { start: 1, end: 2 },
		viewportLines: [
			{ line: 1, text: "const foo = 1;", isCursor: true, isSelected: false },
			{ line: 2, text: "return foo;", isCursor: false, isSelected: false },
		],
	};
}

describe("vim renderResult header has no terminal status glyph", () => {
	it("success renderResult header contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const component = vimToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details: buildDetails(), isError: false },
			{ expanded: false, isPartial: false, spinnerFrame: 0 },
			theme!,
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		const headerLine = rendered.split("\n")[0] ?? "";
		expect(headerLine).not.toMatch(GLYPH_REGEX);
	});

	it("error renderResult header contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const component = vimToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details: buildDetails(), isError: true },
			{ expanded: false, isPartial: false, spinnerFrame: 0 },
			theme!,
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		const headerLine = rendered.split("\n")[0] ?? "";
		expect(headerLine).not.toMatch(GLYPH_REGEX);
	});
});
