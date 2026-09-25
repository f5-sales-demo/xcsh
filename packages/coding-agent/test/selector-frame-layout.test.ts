import { beforeAll, describe, expect, test } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import {
	selectorCompactRow,
	selectorFrame,
	selectorFrameContentWidth,
	selectorProse,
	selectorRow,
} from "../src/modes/components/selector-frame";
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
		const compact = selectorFrame(79, 20, "Title", "", [], [selectorProse("Choice")], [], ["Esc: back"]);
		const spacious = selectorFrame(80, 20, "Title", "", [], [selectorProse("Choice")], [], ["Esc: back"]);

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

	test("wraps classified body prose without losing ANSI-styled Unicode text", () => {
		const width = 32;
		const prose =
			"Read the \u001b[1mcafé 東京 guidance\u001b[22m completely before continuing with this synthetic choice.";
		const lines = selectorFrame(width, 20, "Guidance", "", [], [selectorProse(prose)], [], []);
		const normalized = lines
			.map(line => Bun.stripANSI(line).slice(1, -1).trim())
			.join(" ")
			.replace(/\s+/g, " ");

		expect(lines.every(line => visibleWidth(line) === width)).toBe(true);
		expect(normalized).toContain(Bun.stripANSI(prose));
		expect(normalized).not.toContain("…");
	});

	test("shows the complete selected compact value when its row truncates", () => {
		const width = 32;
		const label = "synthetic-provider/café-東京-model-with-a-complete-selector";
		const lines = selectorFrame(width, 14, "Choose", "", [], [selectorRow([label], [10], true)], [], [], {
			selectedBodyIndex: 0,
		});
		const normalized = lines
			.map(line => Bun.stripANSI(line).slice(1, -1).trim())
			.join("")
			.replace(/\s+/g, "");

		expect(lines.every(line => visibleWidth(line) === width)).toBe(true);
		expect(normalized).toContain(label);
	});

	test("rejects unclassified strings in the frame body at runtime", () => {
		expect(() => selectorFrame(40, 10, "Choose", "", [], ["unclassified prose"] as never, [], [])).toThrow(
			"selectorProse",
		);
	});

	test("rejects a truncating compact row without complete selected detail", () => {
		expect(() => selectorCompactRow("short", true, "", true)).toThrow("complete selected detail");
	});

	test("rejects a caller-managed detail contract when no complete detail is supplied", () => {
		expect(() =>
			selectorFrame(32, 10, "Choose", "", [], [selectorRow(["a very long compact value"], [6], true)], [], [], {
				selectedBodyIndex: 0,
				selectedDetail: "provided",
			}),
		).toThrow("complete selected detail");
	});

	test("requires callers to classify frame body prose", () => {
		const invalidUsage = () => {
			// @ts-expect-error Plain strings are not a classified frame body presentation.
			return selectorFrame(40, 10, "Choose", "", [], ["unclassified prose"], [], []);
		};
		expect(invalidUsage).toBeFunction();
	});
});
