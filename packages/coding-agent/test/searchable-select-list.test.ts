import { beforeAll, describe, expect, it, vi } from "bun:test";
import { getKeybindings, type SelectItem, visibleWidth } from "@f5-sales-demo/pi-tui";
import { SearchableSelectList } from "../src/modes/components/searchable-select-list";
import { getSelectListTheme, setTheme } from "../src/modes/theme/theme";

beforeAll(async () => setTheme("xcsh-dark"));

const items: SelectItem[] = [
	{ value: "scope/alpha", label: "Alpha", description: "First scoped choice" },
	{ value: "scope/beta", label: "Beta", description: "Second scoped choice" },
	{ value: "scope/gamma", label: "Gamma", description: "Third scoped choice" },
];

describe("SearchableSelectList", () => {
	it.each([16, 18, 24])("pages complete ANSI and Unicode prose in %s rows while retaining selection", rows => {
		const previousRows = Object.getOwnPropertyDescriptor(process.stdout, "rows");
		Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true });
		try {
			const description = Array.from({ length: 60 }, (_, index) => `detail${index} café 東京`).join(" ");
			const list = new SearchableSelectList(
				"Choose fixture",
				Array.from({ length: 20 }, (_, index) => `purpose${index}`).join(" "),
				[{ value: "scope/example", label: "Selected fixture", description: `\x1b[31m${description}\x1b[0m` }],
				3,
				getSelectListTheme(),
			);
			let pages = "";
			for (let page = 0; page < 80; page++) {
				const lines = list.render(40);
				expect(lines.length).toBeLessThanOrEqual(process.stdout.rows || 24);
				expect(lines.every(line => visibleWidth(line) <= 40)).toBe(true);
				expect(Bun.stripANSI(lines.join("\n"))).toContain("Selected fixture");
				pages += Bun.stripANSI(lines.join("\n"));
				list.handleInput("\x1b[6~");
			}
			for (let index = 0; index < 60; index++) expect(pages).toContain(`detail${index}`);
			for (let index = 0; index < 20; index++) expect(pages).toContain(`purpose${index}`);
			expect(list.getSelectedItem()?.value).toBe("scope/example");
			list.render(100);
			list.handleInput("\x1b[5~");
			expect(list.render(40).every(line => visibleWidth(line) <= 40)).toBe(true);
		} finally {
			if (previousRows) Object.defineProperty(process.stdout, "rows", previousRows);
			else Reflect.deleteProperty(process.stdout, "rows");
		}
	});

	it("preserves the SelectList API while using the shared searchable bounded frame", () => {
		const selected = vi.fn();
		const preview = vi.fn();
		const cancelled = vi.fn();
		const list = new SearchableSelectList(
			"Choose fixture",
			"Exercise shared selector behavior.",
			items,
			3,
			getSelectListTheme(),
		);
		list.setSelectedIndex(1);
		list.onSelect = selected;
		list.onSelectionChange = preview;
		list.onCancel = cancelled;

		const wide = list.render(140);
		expect(wide.every(line => visibleWidth(line) <= 100)).toBe(true);
		expect(Bun.stripANSI(wide.join("\n"))).toContain("3 of 3 options");
		expect(Bun.stripANSI(wide.join("\n"))).toContain("Identity: scope/beta");

		list.handleInput("g");
		list.handleInput("a");
		const filtered = Bun.stripANSI(list.render(80).join("\n"));
		expect(filtered).toContain("Gamma");
		expect(filtered).not.toContain("Alpha");
		list.handleInput("\x1b");
		expect(Bun.stripANSI(list.render(80).join("\n"))).toContain("Identity: scope/beta");
		list.handleInput("\r");
		expect(selected).toHaveBeenCalledWith(items[1]);
		expect(cancelled).not.toHaveBeenCalled();
		expect(preview).toHaveBeenCalled();
	});

	it("supports wheel and row hit testing through the existing SelectList surface", () => {
		const selected = vi.fn();
		const list = new SearchableSelectList("Choose fixture", "Mouse behavior.", items, 3, getSelectListTheme());
		list.onSelect = selected;
		const lines = list.render(80);
		const gammaLine = lines.findIndex(line => Bun.stripANSI(line).includes("Gamma"));
		expect(gammaLine).toBeGreaterThanOrEqual(0);
		expect(list.hitTest(gammaLine)).toBe(2);
		list.clickItem(2);
		expect(selected).toHaveBeenCalledWith(items[2]);
		list.handleWheel(-1);
		list.handleInput("\r");
		expect(selected).toHaveBeenLastCalledWith(items[1]);
		expect(getKeybindings().getKeys("tui.select.cancel")).toContain("escape");
	});
});
