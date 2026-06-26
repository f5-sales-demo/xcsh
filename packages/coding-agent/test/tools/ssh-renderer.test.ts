import { describe, expect, it } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { sshToolRenderer } from "@f5-sales-demo/xcsh/tools/ssh";
import { getThemeByName } from "../../src/modes/theme/theme";

const GLYPH_REGEX = /[✓✔✗✘⚠ⓘ]/;

describe("ssh renderResult has no terminal status glyph", () => {
	it("success renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "hello from remote\n" }],
			isError: false,
		};
		const component = sshToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			host: "example",
			command: "echo hello",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});

	it("error renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "ssh: connect to host example port 22: Connection refused" }],
			isError: true,
		};
		const component = sshToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			host: "example",
			command: "false",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(GLYPH_REGEX);
	});
});
