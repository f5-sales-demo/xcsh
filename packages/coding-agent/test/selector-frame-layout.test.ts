import { beforeAll, describe, expect, test } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { selectorFrame, selectorFrameContentWidth, selectorRow } from "../src/modes/components/selector-frame";
import { getThemeByName, setSymbolPreset, setThemeInstance } from "../src/modes/theme/theme";

beforeAll(async () => {
	setThemeInstance((await getThemeByName("xcsh-dark"))!);
	await setSymbolPreset("unicode");
});

describe("selectorFrame", () => {
	test("renders one continuous rounded enclosure with a joined header separator", async () => {
		await setSymbolPreset("unicode");
		const width = 80;
		const lines = selectorFrame(
			width,
			24,
			"Choose a provider",
			"Connect access before choosing a model.",
			["Search providers", ">"],
			[selectorRow(["Provider A"], [selectorFrameContentWidth(width) - 2], true)],
			["provider-a · Subscription", "", "Ready"],
			["Up/Down: navigate · Enter: select", "Esc: back"],
			{ selectedBodyIndex: 0 },
		);
		const plain = lines.map(line => Bun.stripANSI(line));

		expect(plain[0]).toBe(`╭${"─".repeat(width - 2)}╮`);
		expect(plain).toContain(`├${"─".repeat(width - 2)}┤`);
		expect(plain.at(-1)).toBe(`╰${"─".repeat(width - 2)}╯`);
		expect(plain.filter(line => line.includes("provider-a · Subscription"))).toHaveLength(1);
		expect(plain.every(line => visibleWidth(line) === width)).toBe(true);
	});

	test("uses one-cell gutters below 80 columns and two-cell gutters at 80 columns", async () => {
		await setSymbolPreset("ascii");
		const compact = selectorFrame(79, 20, "Title", "", [], ["Choice"], [], ["Esc: back"]);
		const spacious = selectorFrame(80, 20, "Title", "", [], ["Choice"], [], ["Esc: back"]);

		expect(Bun.stripANSI(compact[1]!)).toStartWith("| Title");
		expect(Bun.stripANSI(spacious[1]!)).toStartWith("|  Title");
		expect(selectorFrameContentWidth(79)).toBe(75);
		expect(selectorFrameContentWidth(80)).toBe(74);
	});

	test("reserves selected details and controls while keeping the selected body row visible", async () => {
		await setSymbolPreset("unicode");
		const width = 60;
		const contentWidth = selectorFrameContentWidth(width);
		const body = Array.from({ length: 30 }, (_, index) =>
			selectorRow([`Choice ${index + 1}`], [contentWidth - 2], index === 29),
		);
		const lines = selectorFrame(
			width,
			12,
			"Choose",
			"Pick one.",
			[],
			body,
			["Choice 30 details"],
			["Enter: select", "Esc: back"],
			{ selectedBodyIndex: 29 },
		);
		const plain = Bun.stripANSI(lines.join("\n"));

		expect(lines).toHaveLength(12);
		expect(plain).toContain("Choice 30");
		expect(plain).toContain("Choice 30 details");
		expect(plain).toContain("Enter: select");
		expect(plain).toContain("Esc: back");
		expect(lines.every(line => visibleWidth(line) === width)).toBe(true);
	});
});
