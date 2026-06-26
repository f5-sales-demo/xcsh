import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { getThemeByName } from "@f5-sales-demo/xcsh/modes/theme/theme";
import { todoWriteToolRenderer } from "@f5-sales-demo/xcsh/tools/todo-write";

const GLYPH_REGEX = /[✓✔✗✘⚠ⓘ]/;

describe("todo-write renderResult has no terminal status glyph", () => {
	it("success renderResult with tasks contains no ✓/✗/⚠ in header after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "updated" }],
			details: {
				phases: [
					{
						name: "Phase 1",
						tasks: [
							{ id: "t1", content: "first task", status: "completed" as const },
							{ id: "t2", content: "second task", status: "pending" as const },
						],
					},
				],
			},
		};
		const component = todoWriteToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		// Extract header line only (first line) — body intentionally contains task-status checkboxes.
		const headerLine = rendered.split("\n")[0] ?? "";
		expect(headerLine).not.toMatch(GLYPH_REGEX);
	});

	it("empty result fallback header contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "No todos" }],
			details: { phases: [] },
		};
		const component = todoWriteToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		const headerLine = rendered.split("\n")[0] ?? "";
		expect(headerLine).not.toMatch(GLYPH_REGEX);
	});
});
