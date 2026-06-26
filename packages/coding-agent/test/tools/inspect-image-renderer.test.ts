import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { inspectImageToolRenderer } from "@f5-sales-demo/xcsh/tools/inspect-image-renderer";
import { getThemeByName } from "../../src/modes/theme/theme";

const GLYPH_REGEX = /[✓✔✗✘⚠ⓘ]/;

describe("inspect-image renderResult has no terminal status glyph", () => {
	it("success renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "A photo of a cat." }],
			details: {
				model: "gpt-4o",
				imagePath: "/tmp/cat.png",
				mimeType: "image/png",
			},
			isError: false,
		};
		const component = inspectImageToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ path: "/tmp/cat.png", question: "what is this?" },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});

	it("error renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "Error: image not found" }],
			details: undefined,
			isError: true,
		};
		const component = inspectImageToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ path: "/tmp/missing.png" },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});
});
