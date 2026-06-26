import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { renderReadUrlResult } from "@f5-sales-demo/xcsh/tools/fetch";
import { getThemeByName } from "../../src/modes/theme/theme";

const GLYPH_REGEX = /[✓✔✗✘⚠ⓘ]/;

describe("fetch renderReadUrlResult has no terminal status glyph", () => {
	it("success renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "# Example\n\nbody paragraph one\nbody paragraph two\n" }],
			details: {
				kind: "url" as const,
				url: "https://example.com/",
				finalUrl: "https://example.com/",
				contentType: "text/html",
				method: "GET",
				truncated: false,
				notes: [],
			},
		};
		const component = renderReadUrlResult(result as never, { expanded: false, isPartial: false }, theme!);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});

	it("truncated (warning-equivalent) renderResult contains no ✓/✗/⚠ outside output-truncated notice", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "long body content\n".repeat(10) }],
			details: {
				kind: "url" as const,
				url: "https://example.com/big",
				finalUrl: "https://example.com/big",
				contentType: "text/html",
				method: "GET",
				truncated: true,
				notes: [],
			},
		};
		const component = renderReadUrlResult(result as never, { expanded: false, isPartial: false }, theme!);
		const rendered = sanitizeText(component.render(200).join("\n"));
		// The status line itself should not carry a leading terminal glyph; a single
		// "⚠ Output truncated" notice inside Metadata is expected and kept intentionally.
		const lines = rendered.split("\n");
		const header = lines[0] ?? "";
		expect(header).not.toMatch(GLYPH_REGEX);
	});

	it("no-details (error) renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "" }],
		};
		const component = renderReadUrlResult(result as never, { expanded: false, isPartial: false }, theme!);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});
});
