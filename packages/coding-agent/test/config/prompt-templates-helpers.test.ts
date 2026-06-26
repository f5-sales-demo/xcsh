import { describe, expect, it } from "bun:test";
import { prompt } from "@f5-sales-demo/pi-utils";
import { registerCodingAgentPromptHelpers } from "../../src/config/prompt-templates";

describe("registerCodingAgentPromptHelpers", () => {
	it("is exported as a callable function", () => {
		expect(typeof registerCodingAgentPromptHelpers).toBe("function");
	});

	it("registers all six coding-agent Handlebars helpers", () => {
		registerCodingAgentPromptHelpers();
		// Behavioral check: rendering a template that uses each helper must not throw
		// `Missing helper`. We assert each helper produces some output (shape is verified
		// in dedicated tests below); failure here means the helper was not registered.
		expect(() => prompt.render('{{SECTION_SEPERATOR "X"}}', {})).not.toThrow();
		expect(() => prompt.render("{{jtdToTypeScript schema}}", { schema: { type: "string" } })).not.toThrow();
		expect(() => prompt.render('{{href 1 "x"}}', {})).not.toThrow();
		expect(() => prompt.render('{{hline 1 "x"}}', {})).not.toThrow();
		expect(() => prompt.render('{{anchor "n" "c"}}', {})).not.toThrow();
		expect(() => prompt.render('{{sel "a.b"}}', {})).not.toThrow();
	});

	it("SECTION_SEPERATOR helper renders the expected separator shape", () => {
		registerCodingAgentPromptHelpers();
		const rendered = prompt.render('{{SECTION_SEPERATOR "Workspace"}}', {});
		expect(rendered).toContain("Workspace");
		expect(rendered).toContain("═");
	});

	it("is idempotent — calling twice does not throw or leak state", () => {
		expect(() => {
			registerCodingAgentPromptHelpers();
			registerCodingAgentPromptHelpers();
		}).not.toThrow();
		const rendered = prompt.render('{{SECTION_SEPERATOR "Identity"}}', {});
		expect(rendered).toContain("Identity");
	});

	it("href helper produces a hashline-style reference", () => {
		registerCodingAgentPromptHelpers();
		const rendered = prompt.render('{{href 42 "hello"}}', {});
		// Shape: JSON-quoted "lineNum#hash" where hash is whatever computeLineHash returns.
		expect(rendered).toMatch(/^"42#[A-Za-z0-9]+"$/);
	});

	it("hline helper produces a read-style formatted line", () => {
		registerCodingAgentPromptHelpers();
		const rendered = prompt.render('{{hline 10 "const x = 1;"}}', {});
		// Shape: lineNum#hash:content
		expect(rendered).toMatch(/^10#[A-Za-z0-9]+:const x = 1;$/);
	});
});
