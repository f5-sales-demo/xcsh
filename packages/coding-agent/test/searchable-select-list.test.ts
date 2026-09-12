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
