import { expect, test } from "bun:test";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { type TUI, visibleWidth } from "@f5-sales-demo/pi-tui";
import { ToolExecutionComponent } from "../../src/modes/components/tool-execution";
import { initTheme, setSymbolPreset, setTheme } from "../../src/modes/theme/theme";

test("installed guidance reads preserve basename identity at every supported width", async () => {
	await initTheme();
	for (const theme of ["xcsh-dark", "xcsh-light"]) {
		await setTheme(theme);
		for (const preset of ["unicode", "ascii", "nerd"] as const) {
			await setSymbolPreset(preset);
			for (const basename of ["validate.md", "convert.md", "deploy.md", "SKILL.md"]) {
				const path = `/tmp/example-installation/.xcsh/plugins/cache/plugins/example-marketplace___asm-migration___2.3.1/commands/${basename}`;
				const component = new ToolExecutionComponent("read", { path, sel: "", timeout: 20 }, {}, undefined, {
					requestRender() {},
				} as TUI);
				component.setArgsComplete();
				component.updateResult(
					{ content: [{ type: "text", text: "# Safe guidance\n\nRead-only fixture." }] },
					false,
				);
				component.stopAnimation();
				for (const expanded of [false, true]) {
					component.setExpanded(expanded);
					for (const width of [40, 76, 120, 153]) {
						const lines = component.render(width);
						expect(sanitizeText(lines.join("\n"))).toContain(basename);
						expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
					}
				}
			}
		}
	}
});

test("Read retains full long paths and correction guidance in wrapped evidence", async () => {
	await initTheme();
	const original = `/tmp/example-original/${"long-filename-".repeat(8)}.md`;
	const corrected = `/tmp/example-corrected/${"long-filename-".repeat(8)}.md`;
	const component = new ToolExecutionComponent("read", { path: original }, {}, undefined, {
		requestRender() {},
	} as TUI);
	component.setArgsComplete();
	component.updateResult(
		{
			content: [{ type: "text", text: "safe fixture" }],
			details: { suffixResolution: { from: original, to: corrected } },
		},
		false,
	);
	component.stopAnimation();
	component.setExpanded(true);
	const lines = component.render(40);
	expect(lines.every(line => visibleWidth(line) <= 40)).toBe(true);
	const evidence = sanitizeText(lines.join("\n"))
		.split("\n")
		.map(line => line.replace(/^[│|] ?/, "").replace(/ ?[│|]$/, ""))
		.join("");
	expect(evidence).toContain(original);
	expect(evidence).toContain(corrected);
});

test("Read keeps selectors and legacy line ranges next to filename identity", async () => {
	await initTheme();
	const path = `/tmp/${"long-directory/".repeat(12)}validate.md`;
	for (const selection of [
		{ sel: "L10-L50", expected: "validate.md:L10-L50" },
		{ offset: 10, limit: 41, expected: "validate.md:10-50" },
	]) {
		const { expected, ...args } = selection;
		const component = new ToolExecutionComponent("read", { path, ...args }, {}, undefined, {
			requestRender() {},
		} as TUI);
		component.setArgsComplete();
		component.stopAnimation();
		expect(sanitizeText(component.render(40).join("\n"))).toContain(expected);
		component.updateResult({ content: [{ type: "text", text: "selected fixture" }] }, false);
		component.stopAnimation();
		for (const expanded of [false, true]) {
			component.setExpanded(expanded);
			expect(sanitizeText(component.render(40).join("\n"))).toContain(expected);
		}
	}
});

test("Read preserves filename identity for empty and failed results", async () => {
	await initTheme();
	for (const result of [
		{ content: [{ type: "text", text: "" }] },
		{ content: [{ type: "text", text: "File not found: verify the fixture path" }], isError: true },
	]) {
		const component = new ToolExecutionComponent(
			"read",
			{ path: `/tmp/${"directory/".repeat(20)}SKILL.md` },
			{},
			undefined,
			{ requestRender() {} } as TUI,
		);
		component.setArgsComplete();
		component.updateResult(result, false);
		component.stopAnimation();
		for (const expanded of [false, true]) {
			component.setExpanded(expanded);
			for (const width of [40, 76, 120, 153]) {
				const lines = component.render(width);
				expect(sanitizeText(lines.join("\n"))).toContain("SKILL.md");
				expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
				if (result.isError) expect(sanitizeText(lines.join("\n"))).toContain("File not found");
			}
		}
	}
});
