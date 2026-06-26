import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { writeToolRenderer } from "@f5-sales-demo/xcsh/tools/write";
import { getThemeByName } from "../../src/modes/theme/theme";

describe("write renderResult has no terminal status glyph", () => {
	it("success renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "file written" }],
		};
		const component = writeToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			file_path: "/tmp/example.ts",
			content: "export const x = 1;\n",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});
});
