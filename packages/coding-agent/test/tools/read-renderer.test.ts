import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { readToolRenderer } from "@f5-sales-demo/xcsh/tools/read";
import { getThemeByName } from "../../src/modes/theme/theme";

describe("read renderResult has no terminal status glyph (image branch)", () => {
	it("image success renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [
				{ type: "text", text: "" },
				{ type: "image", source: { type: "base64", media_type: "image/png", data: "" } },
			],
		};
		const component = readToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			file_path: "/tmp/test-image.png",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("image with path correction (suffix) contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [
				{ type: "text", text: "" },
				{ type: "image", source: { type: "base64", media_type: "image/png", data: "" } },
			],
			details: {
				suffixResolution: { from: "/tmp/foo", to: "/tmp/foo.png" },
			},
		};
		const component = readToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			file_path: "/tmp/foo",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});
});
