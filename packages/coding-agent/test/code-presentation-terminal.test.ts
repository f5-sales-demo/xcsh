import { afterAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Markdown, visibleWidth } from "@f5-sales-demo/pi-tui";
import { wrapCodeLine } from "../../utils/src/code-presentation";
import { codeCatalogMarkdown, codeLanguageCatalog } from "../../utils/test/fixtures/code-language.catalog";
import { Settings } from "../src/config/settings";
import { AssistantMessageComponent } from "../src/modes/components/assistant-message";
import { PluginViewComponent } from "../src/modes/components/plugin-view";
import { getMarkdownTheme, highlightCode, initTheme, setSymbolPreset, setTheme, theme } from "../src/modes/theme/theme";
import { assistantMsg } from "./utilities";

afterAll(async () => {
	await initTheme();
});

test("per-language terminal acceptance across widths, themes, symbols and tool states", async () => {
	await Settings.init({ inMemory: true, cwd: process.cwd() });
	await initTheme();
	const source = codeCatalogMarkdown();
	const message = assistantMsg(source);
	const assistant = new AssistantMessageComponent(message);
	for (const preset of ["unicode", "ascii", "nerd"] as const) {
		await setSymbolPreset(preset);
		for (const name of ["xcsh-dark", "xcsh-light"]) {
			expect((await setTheme(name)).success).toBe(true);
			assistant.invalidate();
			expect(theme.getFgAnsi("syntaxControl")).not.toBe(theme.getFgAnsi("syntaxKeyword"));
			for (const expanded of [false, true]) {
				const tool = new PluginViewComponent(
					() => ({ sections: [{ kind: "markdown", text: source }] }),
					expanded,
					true,
				);
				const direct = new Markdown(source, 0, 0, getMarkdownTheme());
				for (const width of [40, 76, 120, 153, 200, 240, 40]) {
					for (const component of [direct, assistant, tool]) {
						const lines = component.render(width);
						expect(lines.length).toBeGreaterThan(0);
						expect(
							lines.every(line => visibleWidth(line) <= width),
							`${name} ${preset} ${expanded} ${width}`,
						).toBe(true);
						for (const language of ["json", "yaml", "hcl", "terraform", "bash", "sh", "python", "py", "http"]) {
							const visible = lines.map(Bun.stripANSI).filter(line => line.trim() === language).length;
							expect(visible).toBeLessThanOrEqual(
								codeLanguageCatalog.filter(item => item.id === language).length,
							);
						}
					}
					const lines = direct.render(width);
					for (const category of [
						"syntaxComment",
						"syntaxKeyword",
						"syntaxVariable",
						"syntaxString",
						"syntaxNumber",
						"syntaxOperator",
						"syntaxControl",
					] as const)
						expect(lines.join("\n")).toContain(theme.getFgAnsi(category));
					if (process.env.XCSH_CODE_TERMINAL_DIR) {
						await mkdir(process.env.XCSH_CODE_TERMINAL_DIR, { recursive: true, mode: 0o700 });
						await Bun.write(
							join(
								process.env.XCSH_CODE_TERMINAL_DIR,
								`${name}-${preset}-${expanded ? "expanded" : "collapsed"}-${width}.ansi`,
							),
							`${lines.join("\r\n")}\r\n`,
						);
					}
				}
			}
		}
	}
	expect(message.content).toEqual(assistantMsg(source).content);
}, 120_000);

test("visual wrapping never repeats or loses source characters", async () => {
	await initTheme();
	const source = `printf '%s' '${"literal with spaces ".repeat(40)}end'`;
	for (const width of [40, 76, 120, 153, 200, 240]) {
		const lines = new Markdown(`\`\`\`bash\n${source}\n\`\`\``, 0, 0, getMarkdownTheme())
			.render(width)
			.map(Bun.stripANSI);
		const parts = wrapCodeLine(source, width - 6, visibleWidth);
		expect(lines.length).toBe(parts.length);
		expect(lines.map((line, index) => line.slice(6, 6 + parts[index].end - parts[index].start)).join("")).toBe(
			source,
		);
	}
});

test("existing code panels follow live symbol changes after invalidation", async () => {
	await initTheme();
	await setSymbolPreset("unicode");
	const panel = new Markdown('```json\n{"count":2}\n```', 0, 0, getMarkdownTheme());
	expect(panel.render(76).map(Bun.stripANSI).join("\n")).toContain("│");
	await setSymbolPreset("ascii");
	panel.invalidate();
	const text = panel.render(76).map(Bun.stripANSI).join("\n");
	expect(text).toContain("|");
	expect(text).not.toContain("│");
});

test("plain code uses the active code foreground in both themes", async () => {
	await initTheme();
	for (const name of ["xcsh-dark", "xcsh-light"]) {
		await setTheme(name);
		for (const language of [undefined, "f5-example", "text"])
			expect(highlightCode("opaque source", language)[0]).toContain(theme.getFgAnsi("mdCodeBlock"));
	}
});
