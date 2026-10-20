import { afterAll, beforeAll, expect, test } from "bun:test";
import type { TUI } from "@f5-sales-demo/pi-tui";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { ToolExecutionComponent } from "../src/modes/components/tool-execution";
import { initTheme, setTheme } from "../src/modes/theme/theme";

beforeAll(async () => {
	_resetSettingsForTest();
	await Settings.init({ inMemory: true, overrides: { "bash.verbose": false } });
	await initTheme();
});
afterAll(() => _resetSettingsForTest());

const plain = (lines: string[]) => lines.map(line => Bun.stripANSI(line)).join("\n");
const component = (output: string, isError = false) => {
	const c = new ToolExecutionComponent(
		"bash",
		{ command: "printf '%s' fixture", description: "Read fixture" },
		{},
		undefined,
		{
			requestRender() {},
		} as TUI,
	);
	c.setArgsComplete();
	c.updateResult({ content: [{ type: "text", text: output }], isError }, false);
	return c;
};

test("completed Bash shows result evidence by default across the native presentation matrix", async () => {
	const output = '{\n"identity":"fixture",\n"count":0,\n"enabled":false,\n"empty":"",\n"status":"available"\n}';
	const c = component(output);
	for (const preset of ["unicode", "ascii", "nerd"] as const) {
		await initTheme(false, preset);
		for (const theme of ["xcsh-dark", "xcsh-light"]) {
			await setTheme(theme);
			for (const width of [40, 76, 120, 153]) {
				for (const expanded of [false, true]) {
					c.setExpanded(expanded);
					const lines = c.render(width);
					expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
					const rendered = plain(lines);
					for (const literal of ['"identity"', '"count":0', '"enabled":false', '"empty":""', '"status"'])
						expect(rendered).toContain(literal);
					expect(rendered.match(/"identity"/g)?.length).toBe(1);
				}
			}
		}
	}
});

test("completed Bash bounds long evidence from its beginning and expansion retains the end once", () => {
	const c = component(Array.from({ length: 100 }, (_, i) => `record-${i}`).join("\n"));
	for (const width of [40, 76, 120, 153]) {
		c.setExpanded(false);
		const lines = c.render(width);
		const rendered = plain(lines);
		expect(lines.length).toBeLessThan(22);
		expect(rendered).toContain("record-0");
		expect(rendered).not.toContain("record-99");
		expect(rendered.toLowerCase()).toContain("expand");
		c.setExpanded(true);
		const expanded = plain(c.render(width));
		expect(expanded).toContain("record-99");
		expect(expanded.match(/record-99/g)?.length).toBe(1);
	}
});

test("Bash empty, unavailable, failed and malformed evidence remains honest and literal", () => {
	for (const [output, isError] of [
		["", false],
		["unavailable: retry with --scope=fixture", true],
		["{broken JSON", false],
		["unknown", false],
	] as const) {
		const rendered = plain(component(output, isError).render(76));
		expect(rendered).toContain(output || "No output");
	}
});

test("Bash native partial updates advance and final evidence survives animation retirement", async () => {
	let refreshes = 0;
	const c = new ToolExecutionComponent(
		"bash",
		{ command: "printf fixture", description: "Read fixture" },
		{},
		undefined,
		{
			requestRender() {
				refreshes++;
			},
		} as TUI,
	);
	c.setArgsComplete();
	c.updateResult({ content: [{ type: "text", text: "first" }] }, true);
	expect(plain(c.render(76))).toContain("1 lines");
	c.updateResult({ content: [{ type: "text", text: "first\nsecond" }] }, true);
	expect(plain(c.render(76))).toContain("2 lines");
	c.updateResult({ content: [{ type: "text", text: "completed evidence" }] }, false);
	expect(plain(c.render(76))).toContain("completed evidence");
	const completed = refreshes;
	await Bun.sleep(180);
	expect(refreshes).toBe(completed);
	c.stopAnimation();
	c.updateArgs({ command: "printf fixture", description: "Read fixture" });
	expect(plain(c.render(76))).toContain("completed evidence");
	await Bun.sleep(180);
	expect(refreshes).toBe(completed);
});

test("native Bash preview sanitizes terminal control output and preserves every text block", () => {
	const c = component("\x1b[2Jfirst block");
	c.updateResult(
		{
			content: [
				{ type: "text", text: "\x1b[2Jfirst block" },
				{ type: "text", text: "second block" },
			],
		},
		false,
	);
	for (const expanded of [false, true]) {
		c.setExpanded(expanded);
		const rendered = plain(c.render(76));
		expect(rendered).not.toContain("\x1b[2J");
		expect(rendered.match(/first block/g)?.length).toBe(1);
		expect(rendered.match(/second block/g)?.length).toBe(1);
	}
});
