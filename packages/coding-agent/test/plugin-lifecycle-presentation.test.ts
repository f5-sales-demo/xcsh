import { beforeAll, expect, test } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { PluginLifecycleText } from "../src/modes/components/plugin-lifecycle";
import { PluginViewComponent } from "../src/modes/components/plugin-view";
import { initTheme } from "../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});
test("lifecycle progress retains complete commands and can replace its result", () => {
	const component = new PluginLifecycleText(
		"sf org login web --alias 'synthetic demo'\nTimeout: 90000ms\nVerification: sf org display --json",
	);
	for (const width of [40, 76, 120, 153]) {
		const lines = component.render(width);
		expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
		expect(lines.join("\n")).toContain("90000ms");
	}
	component.setText("Synthetic plugin: ready");
	expect(component.render(76).join("\n")).toContain("ready");
});
test("PluginView preserves empty and falsy fields with complete expanded source", () => {
	const component = new PluginViewComponent(
		() => ({
			summary: "0 results",
			warnings: ["Incomplete results"],
			sections: [
				{ kind: "fields", values: { zero: 0, valid: false, missing: null, empty: "" } },
				{ kind: "table", columns: [{ key: "id" }], rows: [] },
			],
		}),
		true,
	);
	const lines = component.render(40);
	expect(lines.join("\n")).toContain("false");
	expect(lines.join("\n")).toContain("null");
	expect(lines.join("\n")).toContain("0 rows");
	expect(lines.every(line => visibleWidth(line) <= 40)).toBe(true);
});
