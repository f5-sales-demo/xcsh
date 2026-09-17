import { beforeAll, describe, expect, it } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
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

function interior(line: string): string {
	return line.slice(1, -1);
}

function horizontalMargins(line: string): [number, number] {
	const content = interior(line);
	return [content.length - content.trimStart().length, content.length - content.trimEnd().length];
}

describe("WelcomeComponent", () => {
	beforeAll(() => {
		initTheme();
	});

	it("renders the version header", () => {
		const c = new WelcomeComponent("15.15.0");
		expect(renderPlain(c).join("\n")).toContain("xcsh v15.15.0");
	});

	it("renders the full F5 logo at every supported full-logo width", () => {
		const c = new WelcomeComponent("15.15.0");
		for (const width of [50, 51, 52, 80, 145]) {
			const lines = renderPlain(c, width);
			// The logo is drawn with block glyphs; #f5ColorLine keeps █ after ANSI strip.
			expect(lines.join("\n"), `width ${width}`).toContain("█");
			expect(lines.join("\n"), `width ${width}`).not.toContain("│ F5 ");
		}
	});

	it("renders the compact F5 mark only below 50 columns", () => {
		const c = new WelcomeComponent("15.15.0");
		for (const width of [49, 40, 20]) {
			const lines = renderPlain(c, width);
			expect(lines.join("\n"), `width ${width}`).toContain("F5");
			expect(lines.join("\n"), `width ${width}`).not.toContain("█");
		}
	});

	it("uses the crown as the top spacing and retains one blank row below either logo", () => {
		for (const width of [52, 49]) {
			const lines = renderPlain(new WelcomeComponent("15.15.0"), width);
			const divider = lines.findIndex(line => line.startsWith("├"));
			expect(interior(lines[divider + 1]).trim(), `width ${width} first logo row`).not.toBe("");
			expect(interior(lines.at(-2)!).trim(), `width ${width} bottom padding`).toBe("");
			const blankBodyRows = lines.slice(divider + 1, -1).filter(line => interior(line).trim() === "");
			expect(blankBodyRows, `width ${width}`).toHaveLength(1);
		}
	});

	it("keeps exactly one framed gutter column beside the full logo", () => {
		for (const width of [50, 51, 52, 80, 145]) {
			const lines = renderPlain(new WelcomeComponent("15.15.0"), width);
			const widestLogoRow = lines.find(line => interior(line).trimStart().startsWith("|"))!;
			expect(horizontalMargins(widestLogoRow), `width ${width}`).toEqual([1, 1]);
		}
	});

	it("centers the compact fallback", () => {
		for (const width of [49, 41]) {
			const lines = renderPlain(new WelcomeComponent("15.15.0"), width);
			const mark = lines.find(line => line.includes("F5"))!;
			const [left, right] = horizontalMargins(mark);
			expect(Math.abs(left - right), `width ${width}`).toBeLessThanOrEqual(1);
		}
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

	it("keeps every rendered line within the terminal width", () => {
		const c = new WelcomeComponent("15.15.0");
		for (const width of [4, 20, 49, 50, 51, 52, 100, 145]) {
			const lines = c.render(width);
			expect(
				lines.every(line => visibleWidth(line) <= width),
				`width ${width}`,
			).toBe(true);
		}
	});
});
