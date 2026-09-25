import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui/utils";
import { SelectList } from "../src/components/select-list";
import { KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "../src/keybindings";
import type { SgrMouseEvent } from "../src/mouse";

const testTheme = {
	selectedPrefix: (text: string) => text,
	selectedText: (text: string) => text,
	description: (text: string) => text,
	scrollInfo: (text: string) => text,
	noMatch: (text: string) => text,
	symbols: {
		cursor: "→",
		inputCursor: "|",
		hrChar: "─",
		quoteBorder: "│",
		boxRound: { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│" },
		boxSharp: {
			topLeft: "┌",
			topRight: "┐",
			bottomLeft: "└",
			bottomRight: "┘",
			horizontal: "─",
			vertical: "│",
			teeDown: "┬",
			teeUp: "┴",
			teeLeft: "┤",
			teeRight: "├",
			cross: "┼",
		},
		table: {
			topLeft: "┌",
			topRight: "┐",
			bottomLeft: "└",
			bottomRight: "┘",
			horizontal: "─",
			vertical: "│",
			teeDown: "┬",
			teeUp: "┴",
			teeLeft: "┤",
			teeRight: "├",
			cross: "┼",
		},
		spinnerFrames: ["|"],
	},
};

const visibleIndexOf = (line: string, text: string): number => {
	const index = line.indexOf(text);
	expect(index).not.toBe(-1);
	return visibleWidth(line.slice(0, index));
};

const mouseEvent: SgrMouseEvent = {
	button: 0,
	col: 0,
	row: 0,
	release: false,
	wheel: null,
	motion: false,
	leftClick: false,
};

const compactLayout = { presentation: "compact-with-selected-detail" } as const;

describe("SelectList", () => {
	beforeEach(() => {
		setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
	});

	afterEach(() => {
		setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
	});

	it("normalizes multiline descriptions to single line", () => {
		const items = [
			{
				value: "test",
				label: "test",
				description: "Line one\nLine two\nLine three",
			},
		];

		const list = new SelectList(items, 5, testTheme, compactLayout);
		const rendered = list.render(80);

		expect(rendered.length).toBeGreaterThanOrEqual(1);
		expect(rendered[0]).not.toContain("\n");
		expect(rendered[0]).toContain("Line one Line two Line three");
	});

	it("routes hover, wheel, and click through rendered rows", () => {
		const list = new SelectList(
			[
				{ value: "a", label: "a" },
				{ value: "b", label: "b" },
				{ value: "c", label: "c" },
			],
			5,
			{ ...testTheme, hovered: text => `<hover>${text}</hover>` },
			compactLayout,
		);
		let selected: string | undefined;
		list.onSelect = item => {
			selected = item.value;
		};
		list.render(80);
		list.routeMouse({ ...mouseEvent, motion: true }, 1, 0);
		expect(list.render(80).join("\n")).toContain("<hover>");
		list.routeMouse({ ...mouseEvent, wheel: 1 }, 0, 0);
		expect(list.getSelectedItem()?.value).toBe("b");
		list.routeMouse({ ...mouseEvent, leftClick: true }, 2, 0);
		expect(selected).toBe("c");
	});

	it("keeps descriptions aligned when the primary text is truncated", () => {
		const items = [
			{ value: "short", label: "short", description: "short description" },
			{
				value: "very-long-command-name-that-needs-truncation",
				label: "very-long-command-name-that-needs-truncation",
				description: "long description",
			},
		];

		const list = new SelectList(items, 5, testTheme, compactLayout);
		const rendered = list.render(80);

		expect(visibleIndexOf(rendered[0], "short description")).toBe(visibleIndexOf(rendered[1], "long description"));
	});

	it("uses the configured minimum primary column width", () => {
		const items = [
			{ value: "a", label: "a", description: "first" },
			{ value: "bb", label: "bb", description: "second" },
		];

		const list = new SelectList(items, 5, testTheme, {
			presentation: "compact-with-selected-detail",
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 20,
		});
		const rendered = list.render(80);

		expect(rendered[0].indexOf("first")).toBe(14);
		expect(rendered[1].indexOf("second")).toBe(14);
	});

	it("uses the configured maximum primary column width", () => {
		const items = [
			{
				value: "very-long-command-name-that-needs-truncation",
				label: "very-long-command-name-that-needs-truncation",
				description: "first",
			},
			{ value: "short", label: "short", description: "second" },
		];

		const list = new SelectList(items, 5, testTheme, {
			presentation: "compact-with-selected-detail",
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 20,
		});
		const rendered = list.render(80);

		expect(visibleIndexOf(rendered[0], "first")).toBe(22);
		expect(visibleIndexOf(rendered[1], "second")).toBe(22);
	});

	it("allows overriding primary truncation while preserving description alignment", () => {
		const items = [
			{
				value: "very-long-command-name-that-needs-truncation",
				label: "very-long-command-name-that-needs-truncation",
				description: "first",
			},
			{ value: "short", label: "short", description: "second" },
		];

		const list = new SelectList(items, 5, testTheme, {
			presentation: "compact-with-selected-detail",
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 12,
			truncatePrimary: ({ text, maxWidth }) => {
				if (text.length <= maxWidth) {
					return text;
				}

				return `${text.slice(0, Math.max(0, maxWidth - 1))}…`;
			},
		});
		const rendered = list.render(80);

		expect(rendered[0]).toContain("…");
		expect(visibleIndexOf(rendered[0], "first")).toBe(visibleIndexOf(rendered[1], "second"));
	});

	it("confirms the selected item when Enter arrives as LF", () => {
		const items = [{ value: "run", label: "run" }];
		const list = new SelectList(items, 5, testTheme, compactLayout);
		let selectedValue: string | undefined;
		list.onSelect = item => {
			selectedValue = item.value;
		};

		list.handleInput("\n");

		expect(selectedValue).toBe("run");
	});

	it.each([30, 72])("exposes complete selected details at %i columns", width => {
		const label = "synthetic-provider/café-東京-model-with-a-complete-selector";
		const description = "Detailed \u001b[1msynthetic guidance\u001b[22m remains readable without missing words.";
		const list = new SelectList([{ value: label, label, description }], 5, testTheme, {
			presentation: "compact-with-selected-detail",
		});
		const rendered = list.render(width);
		const normalized = Bun.stripANSI(rendered.join(" ")).replace(/\s+/g, " ");

		expect(rendered.every(line => visibleWidth(line) <= width)).toBe(true);
		expect(normalized.replace(/\s+/g, "")).toContain(label);
		expect(normalized).toContain("Detailed synthetic guidance remains readable without missing words.");
		expect(normalized).not.toContain("…");
	});

	it("wraps prose items and keeps continuation rows mouse-addressable", () => {
		const list = new SelectList(
			[
				{
					value: "first",
					label: "First café 東京 option",
					description: "Synthetic explanatory prose remains complete at narrow widths.",
				},
			],
			5,
			testTheme,
			{ presentation: "wrapped-prose" },
		);
		const rendered = list.render(24);
		const normalized = Bun.stripANSI(rendered.join(" ")).replace(/\s+/g, " ");

		expect(rendered.length).toBeGreaterThan(1);
		expect(rendered.every(line => visibleWidth(line) <= 24)).toBe(true);
		expect(normalized).toContain(
			"First café 東京 option — Synthetic explanatory prose remains complete at narrow widths.",
		);
		expect(list.hitTest(1)).toBe(0);
	});

	it("requires an explicit presentation policy", () => {
		const invalidUsage = () => {
			// @ts-expect-error SelectList callers must choose wrapped prose or compact rows with selected detail.
			return new SelectList([], 5, testTheme);
		};
		expect(invalidUsage).toBeFunction();
		expect(() => new SelectList([], 5, testTheme, {} as never)).toThrow("explicit");
	});
});
