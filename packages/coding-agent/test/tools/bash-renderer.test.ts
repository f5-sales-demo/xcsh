import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5xc-salesdemos/pi-natives";
import { bashToolRenderer } from "@f5xc-salesdemos/xcsh/tools/bash";
import { getThemeByName } from "../../src/modes/theme/theme";

describe("bash renderResult has no terminal status glyph", () => {
	it("success renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("dark");
		const result = {
			content: [{ type: "text", text: "hello\n" }],
			isError: false,
		};
		const component = bashToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			command: "echo hello",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("error renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("dark");
		const result = {
			content: [{ type: "text", text: "command failed: exit 1" }],
			isError: true,
		};
		const component = bashToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			command: "false",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});
});
