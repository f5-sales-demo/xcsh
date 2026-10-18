import { beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { type TUI, visibleWidth } from "@f5-sales-demo/pi-tui";
import { Type } from "@sinclair/typebox";
import { presentation } from "../src/extensibility/presentation";
import { PluginViewComponent } from "../src/modes/components/plugin-view";
import { ToolExecutionComponent } from "../src/modes/components/tool-execution";
import { initTheme, setTheme } from "../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});
const plain = (lines: string[]) => lines.map(line => Bun.stripANSI(line));

test("rendered command blocks reconstruct exact Bash/Zsh argv at the actual width", () => {
	const argv = [
		"fixture",
		"",
		"literal's $HOME `false` $(false) ; *",
		"界".repeat(70),
		"first\nlast\tend",
		"--zero=0",
	];
	const view = new PluginViewComponent(() => ({ sections: [presentation.command(argv)] }), false);
	for (const width of [37, 73, 117, 150]) {
		const lines = plain(view.render(width));
		expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
		for (const shell of ["/bin/bash", "/bin/zsh"].filter(existsSync)) {
			const result = Bun.spawnSync([shell, "-c", `fixture() { printf "%s\\0" "$@"; };\n${lines.join("\n")}`]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.toString().split("\0").slice(0, -1)).toEqual(argv.slice(1));
		}
	}
});

test("declared readable column widths reflow narrow tables and preserve twelve preview rows", () => {
	const section = presentation.table(
		Array.from({ length: 15 }, (_, i) => ({ name: `record-${i}`, amount: 1234567.89, currency: "CAD" })),
		[
			{ key: "name", label: "Record", minWidth: 10 },
			{ key: "amount", minWidth: 14, numberFormat: { minimumFractionDigits: 2 } },
			{ key: "currency", minWidth: 8 },
		],
	);
	section.previewRows = 12;
	const c = new PluginViewComponent(() => ({ sections: [section] }), false);
	expect(plain(c.render(37)).join("\n")).toContain("amount: 1,234,567.89");
	expect(plain(c.render(37)).join("\n")).toContain("record-11");
	expect(plain(c.render(37)).join("\n")).toContain("3 more rows");
	for (const width of [37, 73, 117, 150])
		expect(c.render(width).every(line => visibleWidth(line) <= width)).toBe(true);
});

test("registered descriptor receives render width and progress advances then retires", async () => {
	const observed: number[] = [];
	let refreshes = 0;
	const tool = presentation.withPresentation(
		{
			name: "fixture_progress",
			label: "Fixture progress",
			description: "Synthetic",
			parameters: Type.Object({}),
			async execute() {
				return { content: [] };
			},
		},
		{
			result: (_result, options) => {
				observed.push(options.width!);
				return {
					summary: `frame ${options.spinnerFrame}`,
					sections: [presentation.fields({ count: 0, enabled: false, empty: "" })],
				};
			},
		},
	);
	const c = new ToolExecutionComponent(tool.name, {}, {}, tool, {
		requestRender() {
			refreshes++;
		},
	} as TUI);
	c.setArgsComplete();
	c.updateResult({ content: [] }, true);
	const first = plain(c.render(40)).join("\n");
	await Bun.sleep(180);
	expect(refreshes).toBeGreaterThan(0);
	expect(plain(c.render(40)).join("\n")).not.toEqual(first);
	expect(observed.at(-1)).toBe(37);
	for (const preset of ["unicode", "ascii", "nerd"] as const) {
		await initTheme(false, preset);
		for (const themeName of ["xcsh-dark", "xcsh-light"]) {
			await setTheme(themeName);
			for (const width of [40, 76, 120, 153])
				for (const expanded of [false, true]) {
					c.setExpanded(expanded);
					expect(c.render(width).every(line => visibleWidth(line) <= width)).toBe(true);
				}
		}
	}
	c.updateResult({ content: [] }, false);
	expect(plain(c.render(40)).join("\n")).toContain("frame undefined");
	const completedRefreshes = refreshes;
	await Bun.sleep(180);
	expect(refreshes).toBe(completedRefreshes);
	// Shutdown/abort cleanup keeps streamed evidence and prevents late restart.
	c.updateResult({ content: [{ type: "text", text: "partial evidence" }] }, true);
	c.stopAnimation();
	c.updateArgs({});
	const stoppedRefreshes = refreshes;
	await Bun.sleep(180);
	expect(refreshes).toBe(stoppedRefreshes);
});
