import { afterAll, expect, test } from "bun:test";
import { Markdown, visibleWidth } from "@f5-sales-demo/pi-tui";
import catalog from "../../chat-ui/test/markdown/fixtures/synthesized.catalog.json";
import { Settings } from "../src/config/settings";
import { AssistantMessageComponent } from "../src/modes/components/assistant-message";
import { PluginViewComponent } from "../src/modes/components/plugin-view";
import { getMarkdownTheme, initTheme, setSymbolPreset, setTheme } from "../src/modes/theme/theme";
import { assistantMsg } from "./utilities";

afterAll(async () => {
	await initTheme();
});

test("catalog renders through assistant and tool/help Markdown in all terminal settings", async () => {
	await Settings.init({ inMemory: true, cwd: process.cwd() });
	await initTheme();
	for (const preset of ["unicode", "nerd", "ascii"] as const) {
		await setSymbolPreset(preset);
		for (const theme of ["xcsh-dark", "xcsh-light"]) {
			expect((await setTheme(theme)).success).toBe(true);
			for (const item of catalog) {
				// Mermaid has asynchronous prerendering; its literal fallback is checked in
				// the direct renderer while the component path uses the remaining catalog.
				const source = item.markdown.replace(/```mermaid\n[\s\S]*?```/g, "```unknown\nMermaid fallback\n```");
				const message = assistantMsg(source);
				const assistant = new AssistantMessageComponent(message);
				const direct = new Markdown(source, 0, 0, getMarkdownTheme());
				for (const expanded of [false, true]) {
					const tool = new PluginViewComponent(
						() => ({ sections: [{ kind: "markdown", text: source }] }),
						expanded,
						true,
					);
					for (const width of [40, 76, 120, 153, 40]) {
						for (const component of [direct, assistant, tool]) {
							const lines = component.render(width);
							expect(
								lines.every(line => visibleWidth(line) <= width),
								`${item.id} ${preset} ${theme} ${width}`,
							).toBe(true);
							expect(lines.length).toBeGreaterThan(0);
							if (item.id === "tasks") {
								const text = lines.map(Bun.stripANSI).join("\n");
								expect(text).toContain("[x] Ready");
								expect(text).toContain("[ ] Pending");
								expect(text).toContain("9.");
								expect(text).toContain("10.");
							}
						}
					}
				}
				expect(message.content).toEqual(assistantMsg(source).content);
			}
		}
	}
}, 60_000);
