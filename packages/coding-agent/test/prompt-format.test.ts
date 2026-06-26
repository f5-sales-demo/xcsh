import { describe, expect, test } from "bun:test";
import { prompt } from "@f5-sales-demo/pi-utils";

describe("prompt.format renderPhase", () => {
	test("pre-render preserves indentation on Handlebars block lines", () => {
		const input = "<root>\n  {{#if ok}}\n    value\n  {{/if}}\n</root>";

		const output = prompt.format(input, { renderPhase: "pre-render" });

		expect(output).toBe("<root>\n  {{#if ok}}\n    value\n  {{/if}}\n</root>");
	});

	test("pre-render preserves leading tabs", () => {
		const input = "\t<root>\n\t  {{#if ok}}\n\t    value\n\t  {{/if}}\n</root>";

		const output = prompt.format(input, { renderPhase: "pre-render" });

		expect(output).toBe(input);
	});

	test("pre-render trims trailing whitespace", () => {
		const input = "\t<root>   \n\t  {{#if ok}}\t\n\t    value   \n\t  {{/if}} \n</root>";

		const output = prompt.format(input, { renderPhase: "pre-render" });

		expect(output).toBe("\t<root>\n\t  {{#if ok}}\n\t    value\n\t  {{/if}}\n</root>");
	});

	test("post-render mode preserves indentation on Handlebars-like lines", () => {
		const input = "<root>\n  {{#if ok}}\n    value\n  {{/if}}\n</root>";

		const output = prompt.format(input, { renderPhase: "post-render" });

		expect(output).toBe("<root>\n  {{#if ok}}\n    value\n  {{/if}}\n</root>");
	});

	test("pre-render removes blank line before closing Handlebars block while post-render keeps it", () => {
		const input = "<root>\n{{#if ok}}\nvalue\n\n{{/if}}\n</root>";

		const preRender = prompt.format(input, { renderPhase: "pre-render" });
		const postRender = prompt.format(input, { renderPhase: "post-render" });

		expect(preRender).toBe("<root>\n{{#if ok}}\nvalue\n{{/if}}\n</root>");
		expect(postRender).toBe("<root>\n{{#if ok}}\nvalue\n\n{{/if}}\n</root>");
	});
	test("pre-render compacts table rows and does not duplicate content when replacing ascii", () => {
		const input =
			'|`cat <<\'EOF\' > file`|`write(path="file", content="...")`|\n|`sed -i \'s/old/new/\' file`|`edit(path="file", edits=[...])`|';
		const output = prompt.format(input, {
			renderPhase: "pre-render",
			replaceAsciiSymbols: true,
		});
		expect(output).toBe(
			'|`cat <<\'EOF\' > file`|`write(path="file", content="…")`|\n|`sed -i \'s/old/new/\' file`|`edit(path="file", edits=[…])`|',
		);
	});

	describe("prompt.format replaceAsciiSymbols", () => {
		test("does not corrupt HTML comment close delimiter -->", () => {
			const input = "<!-- markdownlint-disable MD055 -->\nfoo -> bar\n<!-- markdownlint-enable MD055 -->";
			const output = prompt.format(input, { replaceAsciiSymbols: true });
			expect(output).toBe("<!-- markdownlint-disable MD055 -->\nfoo → bar\n<!-- markdownlint-enable MD055 -->");
		});

		test("converts standalone -> arrow", () => {
			const output = prompt.format("step 1 -> step 2", { replaceAsciiSymbols: true });
			expect(output).toBe("step 1 → step 2");
		});
	});

	describe("prompt.format boldRfc2119Keywords", () => {
		test("does not double-bold MUST already inside a bold span on the same line", () => {
			const output = prompt.format("your **output MUST be sent**", { boldRfc2119Keywords: true });
			expect(output).toBe("your **output MUST be sent**");
		});

		test("does not bold MUST on a continuation line inside a cross-line bold span", () => {
			const input = "your **first output\nMUST be the catalog tool call**";
			const output = prompt.format(input, { boldRfc2119Keywords: true });
			expect(output).toBe("your **first output\nMUST be the catalog tool call**");
		});

		test("bolds MUST on a line after a cross-line bold span closes", () => {
			const input = "**bold closes here**\nMUST do something";
			const output = prompt.format(input, { boldRfc2119Keywords: true });
			expect(output).toBe("**bold closes here**\n**MUST** do something");
		});

		test("bolds standalone MUST not inside any bold span", () => {
			const output = prompt.format("you MUST do this", { boldRfc2119Keywords: true });
			expect(output).toBe("you **MUST** do this");
		});
	});
});
