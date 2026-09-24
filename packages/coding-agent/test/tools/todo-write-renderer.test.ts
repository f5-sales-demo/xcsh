import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { getThemeByName } from "../../src/modes/theme/theme";
import { todoWriteToolRenderer } from "../../src/tools/todo-write";

const GLYPH_REGEX = /[✓✔✗✘⚠ⓘ]/;

describe("todo-write renderResult has no terminal status glyph", () => {
	it("keeps the todo tree rail when an item wraps after resize", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "updated" }],
			details: {
				phases: [
					{
						name: "Phase 1",
						tasks: [
							{
								id: "t1",
								content: "Check that a long todo item remains inside its tree when the terminal is narrow",
								status: "pending" as const,
							},
							{ id: "t2", content: "second", status: "pending" as const },
						],
					},
				],
			},
		};
		const component = todoWriteToolRenderer.renderResult(
			result as never,
			{ expanded: true, isPartial: false },
			theme!,
		);
		for (const width of [40, 80, 120]) {
			const rows = component.render(width);
			expect(rows.every(row => visibleWidth(row) <= width)).toBe(true);
			const plain = rows.map(sanitizeText);
			expect(plain.join(" ").replace(/[│├└]/g, " ").replace(/\s+/g, " ")).toContain("terminal is narrow");
			if (width === 40) expect(plain.some(row => row.startsWith("│  ") && row.includes("narrow"))).toBe(true);
		}
	});
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
