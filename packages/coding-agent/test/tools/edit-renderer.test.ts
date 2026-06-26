import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { editToolRenderer } from "@f5-sales-demo/xcsh/edit/renderer";
import { getThemeByName } from "../../src/modes/theme/theme";

const GLYPH_REGEX = /[✓✔✗✘⚠ⓘ]/;

describe("edit renderResult has no terminal status glyph", () => {
	it("single-file success renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "edited" }],
			details: {
				diff: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-foo\n+bar\n",
			},
			isError: false,
		};
		const component = editToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			file_path: "/tmp/foo.ts",
			oldText: "foo",
			newText: "bar",
		} as never);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});

	it("single-file error renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "Error: could not apply edit" }],
			details: undefined,
			isError: true,
		};
		const component = editToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			file_path: "/tmp/foo.ts",
			oldText: "foo",
			newText: "bar",
		} as never);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});

	it("multi-file renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "edited multiple" }],
			details: {
				diff: "",
				perFileResults: [
					{
						path: "/tmp/a.ts",
						diff: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
					},
					{
						path: "/tmp/b.ts",
						diff: "",
						isError: true,
						errorText: "failed to write b.ts",
					},
				],
			},
			isError: false,
		};
		const component = editToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			edits: [
				{ path: "/tmp/a.ts", oldText: "a", newText: "b" },
				{ path: "/tmp/b.ts", oldText: "x", newText: "y" },
			],
		} as never);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});
});
