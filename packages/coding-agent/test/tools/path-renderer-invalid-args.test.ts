import { beforeAll, describe, expect, it } from "bun:test";
import type { Component } from "@f5-sales-demo/pi-tui";
import { editToolRenderer } from "../../src/edit/renderer";
import { getThemeByName, initTheme, type Theme } from "../../src/modes/theme/theme";
import { browserRenderer } from "../../src/tools/browser-renderer";
import { inspectImageToolRenderer } from "../../src/tools/inspect-image-renderer";
import { readToolRenderer } from "../../src/tools/read";
import { writeToolRenderer } from "../../src/tools/write";

interface InvalidPathCase {
	readonly name: string;
	readonly path: unknown;
}

const invalidPathCases: readonly InvalidPathCase[] = [
	{ name: "array path", path: ["src/example.ts"] },
	{ name: "object path", path: { value: "src/example.ts" } },
];

let uiTheme: Theme;

beforeAll(async () => {
	await initTheme();
	const theme = await getThemeByName("xcsh-dark");
	if (!theme) throw new Error("dark theme missing");
	uiTheme = theme;
});

function renderPlain(component: Component, width = 120): string {
	let rendered = "";
	expect(() => {
		rendered = Bun.stripANSI(component.render(width).join("\n"));
	}).not.toThrow();
	return rendered;
}

describe("tool path renderers with invalid provider arguments", () => {
	for (const invalid of invalidPathCases) {
		it(`read renderer does not throw for ${invalid.name}`, () => {
			let callComponent: Component | undefined;
			expect(() => {
				callComponent = readToolRenderer.renderCall(
					{ path: invalid.path },
					{ expanded: false, isPartial: true },
					uiTheme,
				);
			}).not.toThrow();
			expect(renderPlain(callComponent!)).toContain("Read");

			let resultComponent: Component | undefined;
			expect(() => {
				resultComponent = readToolRenderer.renderResult(
					{
						content: [{ type: "text", text: "hello from read" }],
						details: { contentType: "text/plain" },
					},
					{ expanded: false, isPartial: false },
					uiTheme,
					{ path: invalid.path },
				);
			}).not.toThrow();
			const rendered = renderPlain(resultComponent!);
			expect(rendered).toContain("Read");
			expect(rendered).toContain("hello from read");
		});

		it(`write renderer does not throw for ${invalid.name}`, () => {
			let callComponent: Component | undefined;
			expect(() => {
				callComponent = writeToolRenderer.renderCall(
					{ path: invalid.path, content: "first line\nsecond line" },
					{ expanded: false, isPartial: true, spinnerFrame: 0 },
					uiTheme,
				);
			}).not.toThrow();
			const callText = renderPlain(callComponent!);
			expect(callText).toContain("Write");
			expect(callText).toContain("second line");

			let resultComponent: Component | undefined;
			expect(() => {
				resultComponent = writeToolRenderer.renderResult(
					{
						content: [{ type: "text", text: "Wrote file" }],
						details: {},
					},
					{ expanded: false, isPartial: false },
					uiTheme,
					{ path: invalid.path, content: "first line\nsecond line" },
				);
			}).not.toThrow();
			const resultText = renderPlain(resultComponent!);
			expect(resultText).toContain("Write");
			expect(resultText).toContain("first line");
		});

		it(`edit renderer does not throw for ${invalid.name}`, () => {
			let callComponent: Component | undefined;
			expect(() => {
				callComponent = editToolRenderer.renderCall(
					{ path: invalid.path, oldText: "before", newText: "after" },
					{ expanded: false, isPartial: true, spinnerFrame: 0 },
					uiTheme,
				);
			}).not.toThrow();
			expect(renderPlain(callComponent!)).toContain("Edit");

			let resultComponent: Component | undefined;
			expect(() => {
				resultComponent = editToolRenderer.renderResult(
					{
						content: [{ type: "text", text: "updated" }],
						details: { diff: "-before\n+after" },
					},
					{ expanded: false, isPartial: false },
					uiTheme,
					{ path: invalid.path, oldText: "before", newText: "after" },
				);
			}).not.toThrow();
			const rendered = renderPlain(resultComponent!);
			expect(rendered).toContain("Edit");
			expect(rendered).toContain("after");
		});

		it(`inspect-image renderer does not throw for ${invalid.name}`, () => {
			const call = inspectImageToolRenderer.renderCall(
				{ path: invalid.path },
				{ expanded: false, isPartial: true },
				uiTheme,
			);
			expect(renderPlain(call)).toContain("Inspect Image");

			const result = inspectImageToolRenderer.renderResult(
				{ content: [{ type: "text", text: "analysis" }] },
				{ expanded: false, isPartial: false },
				uiTheme,
				{ path: invalid.path },
			);
			expect(renderPlain(result)).toContain("Inspect Image");
		});

		it(`browser renderer does not throw for ${invalid.name}`, () => {
			const result = browserRenderer.renderResult(
				{
					content: [{ type: "text", text: "captured" }],
					details: { action: "screenshot", screenshotPath: invalid.path } as never,
				},
				{ expanded: false, isPartial: false },
				uiTheme,
			);
			expect(renderPlain(result)).toContain("Browser");
		});
	}

	it("coerces non-string write content at both renderer boundaries", () => {
		const runtimeContent = ["first\r\nsecond"];
		const call = writeToolRenderer.renderCall(
			{ path: "/tmp/runtime-content.ts", content: runtimeContent },
			{ expanded: true, isPartial: true, spinnerFrame: 0 },
			uiTheme,
		);
		const callText = renderPlain(call);
		expect(callText).toContain("first");
		expect(callText).toContain("second");
		expect(callText).not.toContain("\r");

		const result = writeToolRenderer.renderResult(
			{
				content: [{ type: "text", text: "Wrote file" }],
				details: {},
			},
			{ expanded: true, isPartial: false },
			uiTheme,
			{ path: "/tmp/runtime-content.ts", content: runtimeContent },
		);
		const resultText = renderPlain(result);
		expect(resultText).toContain("first");
		expect(resultText).toContain("second");
		expect(resultText).not.toContain("\r");
	});
});
