import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type TUI, visibleWidth } from "@f5-sales-demo/pi-tui";
import { PluginLifecycleText } from "../src/modes/components/plugin-lifecycle";
import { ToolExecutionComponent } from "../src/modes/components/tool-execution";
import { initTheme, setTheme } from "../src/modes/theme/theme";

const root = resolve(import.meta.dir, "../../..");
const output = join(root, "packages/coding-agent/test/evidence/plugin-presentation-v1");
const sourcePaths = [
	"packages/coding-agent/src/modes/components/plugin-lifecycle.ts",
	"packages/coding-agent/src/modes/components/plugin-view.ts",
	"packages/coding-agent/src/modes/components/tool-execution.ts",
	"packages/tui/src/components/table.ts",
	"packages/tui/src/components/markdown.ts",
];
const sourceHashes = Object.fromEntries(
	await Promise.all(
		sourcePaths.map(async path => [
			path,
			createHash("sha256")
				.update(await Bun.file(join(root, path)).bytes())
				.digest("hex"),
		]),
	),
);
const captures = [];
for (const theme of ["xcsh-dark", "xcsh-light"]) {
	for (const preset of ["unicode", "ascii", "nerd"] as const) {
		await initTheme(false, preset);
		await setTheme(theme);
		for (const width of [40, 76, 120, 153]) {
			for (const expanded of [false, true]) {
				const tool = new ToolExecutionComponent(
					"synthetic plugin",
					{ query: "SELECT COUNT(Id) total", args: ["--scope", "synthetic"] },
					{},
					undefined,
					{ requestRender() {} } as TUI,
				);
				tool.updateResult({
					content: [
						{
							type: "text",
							text: JSON.stringify({
								records: Array.from({ length: 12 }, (_, i) => ({
									id: `synthetic-${i}`,
									total: 0,
									valid: false,
									missing: null,
									note: "界👩‍💻\nsynthetic multiline value",
								})),
								done: false,
								warning: "Incomplete synthetic results",
							}),
						},
					],
				});
				tool.setExpanded(expanded);
				const lines = tool.render(width);
				const lifecycle = new PluginLifecycleText(
					"Synthetic setup review\nsf org login web --alias 'synthetic demo'\nTimeout: 90000ms\nVerification: sf org display --json",
				).render(width);
				if ([...lines, ...lifecycle].some(line => visibleWidth(line) > width))
					throw new Error("Capture exceeds viewport");
				captures.push({ theme, preset, width, expanded, lines, lifecycle });
			}
		}
	}
}
await mkdir(output, { recursive: true });
await Bun.write(
	join(output, "captures.json"),
	`${JSON.stringify({ synthetic: true, sourceHashes, captures }, null, 2)}\n`,
);
console.log(`Captured ${captures.length} synthetic presentations with bounded widths.`);
