import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { Settings } from "@f5-sales-demo/xcsh/config/settings";
import { createTools, type ToolSession } from "@f5-sales-demo/xcsh/tools";
import { calculatorToolRenderer } from "@f5-sales-demo/xcsh/tools/calculator";
import { getThemeByName } from "../../src/modes/theme/theme";

function createTestSession(cwd = "/tmp/test", overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd,
		hasUI: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		...overrides,
	};
}

describe("calculator renderResult has no terminal status glyph", () => {
	it("zero-output renderResult contains no glyph after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "" }],
			details: { results: [] },
		};
		const component = calculatorToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ calculations: [] },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("success renderResult contains no glyph after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "2" }],
			details: {
				results: [{ expression: "1+1", value: 2, output: "2" }],
			},
		};
		const component = calculatorToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ calculations: [{ expression: "1+1", prefix: "", suffix: "" }] },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("error renderResult contains no glyph after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "Invalid expression" }],
			details: { results: [] },
			isError: true,
		};
		const component = calculatorToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ calculations: [{ expression: "bogus", prefix: "", suffix: "" }] },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});
});

describe("calculator execute signals isWarning on 0 outputs", () => {
	it("result.isWarning is true when outputs array is empty", async () => {
		const tools = await createTools(createTestSession());
		const tool = tools.find(entry => entry.name === "calc");
		expect(tool).toBeDefined();

		const result = await tool!.execute("calculator-isWarning-none", { calculations: [] });
		expect(result.isWarning).toBe(true);
	});

	it("result.isWarning is falsy when outputs present", async () => {
		const tools = await createTools(createTestSession());
		const tool = tools.find(entry => entry.name === "calc");
		expect(tool).toBeDefined();

		const result = await tool!.execute("calculator-isWarning-match", {
			calculations: [{ expression: "1+1", prefix: "", suffix: "" }],
		});
		expect(result.isWarning).toBeFalsy();
	});
});
