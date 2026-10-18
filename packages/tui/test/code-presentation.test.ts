import { expect, test } from "bun:test";
import { Markdown } from "../src/components/markdown";
import { visibleWidth } from "../src/utils";
import { defaultMarkdownTheme } from "./test-themes";

test("code metadata is invisible and complete JSON is legible", () => {
	const lines = new Markdown('```json\n{"name":"f5-demo","count":9007199254740993}\n```', 0, 0, defaultMarkdownTheme)
		.render(76)
		.map(Bun.stripANSI);
	expect(lines.join("\n")).not.toContain("json");
	expect(lines.join("\n")).not.toContain("```");
	expect(lines.join("\n")).toContain('  "name": "f5-demo",');
	expect(lines.join("\n")).toContain("9007199254740993");
});

test("code wraps with a visual continuation gutter at every required width", () => {
	for (const width of [40, 76, 120, 153, 200, 240]) {
		const lines = new Markdown(
			`\`\`\`bash\nprintf '%s' '${"x".repeat(300)}'\n\`\`\``,
			0,
			0,
			defaultMarkdownTheme,
		).render(width);
		expect(lines.every(s => visibleWidth(s) <= width)).toBe(true);
		expect(lines.map(Bun.stripANSI).some(s => s.includes(defaultMarkdownTheme.symbols.boxSharp.teeRight))).toBe(true);
	}
});
