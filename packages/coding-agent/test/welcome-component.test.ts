import { beforeAll, describe, expect, it } from "bun:test";
import { registerLocales } from "@f5-sales-demo/pi-utils";
import { locales } from "../src/locales/index";
import { WelcomeComponent } from "../src/modes/components/welcome";
import { initTheme } from "../src/modes/theme/theme";

registerLocales(locales);

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}
function renderPlain(component: WelcomeComponent, width = 120): string[] {
	return component.render(width).map(stripAnsi);
}

describe("WelcomeComponent", () => {
	beforeAll(() => {
		initTheme();
	});

	it("renders the version header", () => {
		const c = new WelcomeComponent("15.15.0");
		expect(renderPlain(c).join("\n")).toContain("xcsh v15.15.0");
	});

	it("renders the F5 logo", () => {
		const c = new WelcomeComponent("15.15.0");
		// The logo is drawn with block glyphs; #f5ColorLine keeps █ after ANSI strip.
		expect(renderPlain(c).join("\n")).toContain("█");
	});

	it("returns empty for a narrow terminal", () => {
		const c = new WelcomeComponent("15.15.0");
		expect(c.render(3)).toEqual([]);
	});

	it("renders no status panel (model / services / plugins / update)", () => {
		const c = new WelcomeComponent("15.15.0");
		const out = renderPlain(c).join("\n");
		expect(out).not.toContain("Model Provider");
		expect(out).not.toContain("F5 XC Context");
		expect(out).not.toContain("Plugins");
		expect(out).not.toContain("xcsh update");
	});

	it("keeps the box within the terminal width", () => {
		const c = new WelcomeComponent("15.15.0");
		const lines = renderPlain(c, 100);
		expect(lines[0].length).toBeGreaterThan(0);
		expect(lines[0].length).toBeLessThanOrEqual(98);
	});
});
