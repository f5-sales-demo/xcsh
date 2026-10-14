import { describe, expect, test } from "bun:test";
import { renderTable } from "../src/components/table";
import { visibleWidth } from "../src/utils";

const symbols = {
	topLeft: "+",
	topRight: "+",
	bottomLeft: "+",
	bottomRight: "+",
	horizontal: "-",
	vertical: "|",
	teeDown: "+",
	teeUp: "+",
	teeLeft: "+",
	teeRight: "+",
	cross: "+",
};
describe("shared plugin and Markdown tables", () => {
	for (const width of [40, 76, 120, 153]) {
		test(`wraps complete Unicode and multiline cells at ${width}`, () => {
			const lines = renderTable(
				["Identifier", "Total", "Notes"],
				[
					["界".repeat(80), "0", "first\nlast"],
					["é👩‍💻", "123", "false/null"],
				],
				width,
				{ symbols, bold: s => s },
			);
			expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
			expect(lines.join("\n")).toContain("last");
			expect(lines.join("\n").match(/界/g)?.length).toBe(80);
			expect(
				lines
					.filter(line => line.startsWith("|"))
					.map(visibleWidth)
					.every(w => w === visibleWidth(lines[0])),
			).toBe(true);
		});
	}
	test("reflows wide records into labeled fields", () => {
		const lines = renderTable(
			Array.from({ length: 12 }, (_, i) => `Field ${i}`),
			[Array.from({ length: 12 }, (_, i) => `value-${i}`)],
			40,
			{ symbols, bold: s => s },
		);
		expect(lines.join("\n")).toContain("Field 11: value-11");
		expect(lines.every(line => visibleWidth(line) <= 40)).toBe(true);
	});
});
