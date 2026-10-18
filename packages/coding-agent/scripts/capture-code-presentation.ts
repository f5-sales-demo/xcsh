import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Markdown } from "@f5-sales-demo/pi-tui";
import { codeLanguageCatalog } from "../../utils/test/fixtures/code-language.catalog";
import { getMarkdownTheme, initTheme, setSymbolPreset, setTheme } from "../src/modes/theme/theme";

const directory = process.argv[2];
if (!directory) throw new Error("Pass a private capture directory");
await mkdir(directory, { recursive: true, mode: 0o700 });
const examples = codeLanguageCatalog.filter(item =>
	["json-compact", "yaml-compact", "hcl", "bash", "python", "http-api-call"].includes(item.id),
);
await initTheme();
for (const preset of ["unicode", "ascii", "nerd"] as const) {
	await setSymbolPreset(preset);
	for (const name of ["xcsh-dark", "xcsh-light"]) {
		await setTheme(name);
		for (const width of [40, 76, 120, 153, 200, 240]) {
			const markdown = examples.map(item => `\`\`\`${item.language}\n${item.source}\n\`\`\``).join("\n\n");
			const lines = new Markdown(markdown, 0, 0, getMarkdownTheme()).render(width);
			await Bun.write(join(directory, `${name}-${preset}-${width}.ansi`), `\x1b[2J\x1b[H${lines.join("\r\n")}\r\n`);
		}
	}
}
