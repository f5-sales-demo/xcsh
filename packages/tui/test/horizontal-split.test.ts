import { describe, expect, it } from "bun:test";
import type { Component } from "@f5-sales-demo/pi-tui";
import { HorizontalSplit, type SplitChild } from "@f5-sales-demo/pi-tui/horizontal-split";

/** Component stub that records the width it was asked to render at and emits a fixed string. */
class StubComponent implements Component {
	lastWidth: number | null = null;
	constructor(public readonly lines: string[]) {}
	render(width: number): string[] {
		this.lastWidth = width;
		return this.lines;
	}
	invalidate(): void {}
}

const fixedChild = (c: Component, value: number, priority = 100): SplitChild => ({
	component: c,
	width: { kind: "fixed", value },
	priority,
});

describe("HorizontalSplit — fixed-width allocation", () => {
	it("passes each fixed child its configured width on render", () => {
		const a = new StubComponent(["AAA"]);
		const b = new StubComponent(["BBBBB"]);
		const split = new HorizontalSplit([fixedChild(a, 3), fixedChild(b, 5)], " ");
		split.render(9);
		expect(a.lastWidth).toBe(3);
		expect(b.lastWidth).toBe(5);
	});

	it("joins children with the configured single-character separator", () => {
		const a = new StubComponent(["AAA"]);
		const b = new StubComponent(["BBBBB"]);
		const split = new HorizontalSplit([fixedChild(a, 3), fixedChild(b, 5)], "|");
		const rows = split.render(9);
		expect(rows).toEqual(["AAA\x1b[0m|BBBBB\x1b[0m"]);
	});

	it("defaults the separator to a single space when omitted", () => {
		const a = new StubComponent(["AAA"]);
		const b = new StubComponent(["BBB"]);
		const split = new HorizontalSplit([fixedChild(a, 3), fixedChild(b, 3)]);
		const rows = split.render(7);
		expect(rows[0]).toBe("AAA\x1b[0m BBB\x1b[0m");
	});
});

const flexChild = (c: Component, value: number, opts: { minWidth?: number; priority?: number } = {}): SplitChild => ({
	component: c,
	width: { kind: "flex", value, minWidth: opts.minWidth },
	priority: opts.priority ?? 100,
});

describe("HorizontalSplit — flex allocation", () => {
	it("splits remaining columns proportionally between flex children", () => {
		const a = new StubComponent(["A"]);
		const b = new StubComponent(["B"]);
		const split = new HorizontalSplit([flexChild(a, 2), flexChild(b, 1)], " ");
		// total = 31, separator = 1, remaining = 30, flex 2:1 → 20:10
		split.render(31);
		expect(a.lastWidth).toBe(20);
		expect(b.lastWidth).toBe(10);
	});

	it("mixes fixed and flex: fixed first, remainder to flex", () => {
		const left = new StubComponent(["L"]);
		const right = new StubComponent(["R"]);
		const split = new HorizontalSplit([fixedChild(left, 10), flexChild(right, 1)], " ");
		// total = 50, separator = 1, fixed = 10, flex gets remaining 39
		split.render(50);
		expect(left.lastWidth).toBe(10);
		expect(right.lastWidth).toBe(39);
	});

	it("splits remainder across three flex children proportionally", () => {
		const a = new StubComponent([]);
		const b = new StubComponent([]);
		const c = new StubComponent([]);
		// flex 1:1:2, total width 22, separators = 2, remaining = 20 → 5:5:10
		const split = new HorizontalSplit([flexChild(a, 1), flexChild(b, 1), flexChild(c, 2)], " ");
		split.render(22);
		expect(a.lastWidth).toBe(5);
		expect(b.lastWidth).toBe(5);
		expect(c.lastWidth).toBe(10);
	});

	it("distributes leftover columns from rounding to the largest-share child", () => {
		const a = new StubComponent([]);
		const b = new StubComponent([]);
		// flex 1:1, remaining = 5 → ideal 2.5:2.5, integer 2:3 (remainder to
		// the last or the largest — either is acceptable, but the sum must
		// equal the remaining columns).
		const split = new HorizontalSplit([flexChild(a, 1), flexChild(b, 1)], " ");
		split.render(6); // separator = 1, remaining = 5
		expect((a.lastWidth ?? 0) + (b.lastWidth ?? 0)).toBe(5);
	});
});

describe("HorizontalSplit — binary collapse", () => {
	it("drops the lowest-priority flex child when its minWidth is unmet", () => {
		const main = new StubComponent(["MAIN"]);
		const side = new StubComponent(["SIDE"]);
		const split = new HorizontalSplit(
			[
				flexChild(main, 1, { minWidth: 10, priority: 10 }),
				flexChild(side, 0, { minWidth: 20, priority: 1 }), // lower priority
			],
			" ",
		);
		// width = 25, separator = 1, remaining = 24. Proportional on flex 1:0
		// gives main=24 and side=0, side has minWidth 20 → unmet → drop side.
		// After drop: no separator, main fills 25.
		split.render(25);
		expect(main.lastWidth).toBe(25);
		expect(side.lastWidth).toBeNull(); // not rendered
	});

	it("suppresses the separator when a child is collapsed", () => {
		const main = new StubComponent(["MAIN"]);
		const side = new StubComponent(["SIDE"]);
		const split = new HorizontalSplit(
			[flexChild(main, 1, { minWidth: 10, priority: 10 }), flexChild(side, 0, { minWidth: 20, priority: 1 })],
			"|",
		);
		const rows = split.render(25);
		// With side dropped, output must contain no separator '|'
		expect(rows[0]).not.toContain("|");
	});

	it("drops in ascending priority order when multiple minimums are unmet", () => {
		const a = new StubComponent([]);
		const b = new StubComponent([]);
		const c = new StubComponent([]);
		// Each child wants 20 cols. Budget = 30 (minus 2 separators = 28).
		// After proportional 1:1:1 allocation each gets ~9. All three violate.
		// Drop c first (priority 1), retry with 29 cols between two children:
		// 14:15, a still violates min 20. Drop b (priority 2), retry: a alone
		// gets 30 (full width since no separators remain) — satisfies min.
		const split = new HorizontalSplit(
			[
				flexChild(a, 1, { minWidth: 20, priority: 100 }),
				flexChild(b, 1, { minWidth: 20, priority: 2 }),
				flexChild(c, 1, { minWidth: 20, priority: 1 }),
			],
			" ",
		);
		split.render(30);
		expect(a.lastWidth).toBe(30);
		expect(b.lastWidth).toBeNull();
		expect(c.lastWidth).toBeNull();
	});
});

describe("HorizontalSplit — unsatisfiable-minimums fallback", () => {
	it("expands the highest-priority flex child to full width when no minimum can be met", () => {
		const a = new StubComponent(["A"]);
		const b = new StubComponent(["B"]);
		const split = new HorizontalSplit(
			[flexChild(a, 1, { minWidth: 50, priority: 100 }), flexChild(b, 1, { minWidth: 50, priority: 1 })],
			"|",
		);
		// total = 20, even after dropping b, a's minWidth 50 is still unmet.
		// Fallback: expand highest-priority child (a) to consume everything,
		// no separators rendered.
		split.render(20);
		expect(a.lastWidth).toBe(20);
		expect(b.lastWidth).toBeNull();
		const rows = split.render(20);
		expect(rows[0]).not.toContain("|");
	});
});

describe("HorizontalSplit — line composition", () => {
	it("renders each child within its allocated column width", () => {
		const a = new StubComponent(["AA"]); // 2 cols
		const b = new StubComponent(["BBBB"]); // 4 cols
		const split = new HorizontalSplit([fixedChild(a, 4), fixedChild(b, 4)], " ");
		// total = 9, separator = 1, both children get 4.
		// child a's "AA" pads to 4 cols → "AA  "; child b's "BBBB" stays.
		const rows = split.render(9);
		expect(rows).toEqual(["AA  \x1b[0m BBBB\x1b[0m"]);
	});

	it("matches the taller child's row count by padding shorter child with blank lines", () => {
		const a = new StubComponent(["A1", "A2", "A3"]);
		const b = new StubComponent(["B1"]);
		const split = new HorizontalSplit([fixedChild(a, 2), fixedChild(b, 2)], " ");
		const rows = split.render(5);
		expect(rows).toHaveLength(3);
		expect(rows[0]).toBe("A1\x1b[0m B1\x1b[0m");
		// Subsequent rows: b is empty → padded to 2 cols of unstyled space.
		expect(rows[1]).toBe("A2\x1b[0m   \x1b[0m");
		expect(rows[2]).toBe("A3\x1b[0m   \x1b[0m");
	});

	it("returns an empty row array when all children have 0 rendered rows", () => {
		const a = new StubComponent([]);
		const b = new StubComponent([]);
		const split = new HorizontalSplit([fixedChild(a, 2), fixedChild(b, 2)], " ");
		expect(split.render(5)).toEqual([]);
	});
});

describe("HorizontalSplit — unconditional SGR reset", () => {
	it("appends \\x1b[0m to every composed row regardless of child content", () => {
		const a = new StubComponent(["plain"]);
		const b = new StubComponent(["plain"]);
		const split = new HorizontalSplit([fixedChild(a, 5), fixedChild(b, 5)], " ");
		for (const row of split.render(11)) {
			expect(row.endsWith("\x1b[0m")).toBe(true);
		}
	});

	it("closes unclosed SGR state from a child rather than bleeding into next row", () => {
		// Child A emits row 0 with unclosed \x1b[31m (red). The reset at row
		// end must make it impossible for the NEXT row to inherit redness.
		const a = new StubComponent(["\x1b[31mRED", "plain"]);
		const b = new StubComponent(["B1", "B2"]);
		const split = new HorizontalSplit([fixedChild(a, 5), fixedChild(b, 3)], " ");
		const rows = split.render(9);
		// Row 0 must end with reset.
		expect(rows[0]!.endsWith("\x1b[0m")).toBe(true);
		// Row 1 must not start with any inherited SGR state — it begins with
		// the literal child A row-1 content ("plain" fits exactly in 5 cols).
		expect(rows[1]!.startsWith("plain")).toBe(true);
	});
});

describe("HorizontalSplit — wide-character boundary rule", () => {
	it("replaces a wide char straddling the rightmost column with a space", () => {
		// Child A has width 3 and content "a日" — "a" = 1 col, "日" = 2 cols,
		// total = 3. It fits exactly. Now shrink to width 2: "日" would start
		// at col 1 and straddle columns 1-2, leaving "a" at col 0. The slice
		// must yield "a " (2 cols) — wide char dropped, replaced by space.
		const a = new StubComponent(["a日"]);
		const b = new StubComponent(["X"]);
		const split = new HorizontalSplit([fixedChild(a, 2), fixedChild(b, 1)], "|");
		const rows = split.render(4);
		// Row 0: "a |X\x1b[0m" — a's right column is a space replacing the
		// would-be-straddling wide char.
		expect(rows[0]).toBe("a \x1b[0m|X\x1b[0m");
	});

	it("adjacent child starts at its own column 0 regardless of wide-char drop", () => {
		// Child A loses one column to a wide-char drop. Child B still begins
		// rendering from column 0 of its own allocation.
		const a = new StubComponent(["日"]); // only a wide char, allocate 1 col
		const b = new StubComponent(["ZZZ"]);
		const split = new HorizontalSplit([fixedChild(a, 1), fixedChild(b, 3)], " ");
		const rows = split.render(5);
		// A's 1-col allocation cannot fit the 2-col "日" — result is " " (a
		// single space replacing the wide char). B is unaffected.
		expect(rows[0]).toBe(" \x1b[0m ZZZ\x1b[0m");
	});
});

describe("HorizontalSplit — collapsed-state output", () => {
	it("contains no separator character when a child is collapsed", () => {
		const main = new StubComponent(["MAIN"]);
		const side = new StubComponent(["SIDE"]);
		const split = new HorizontalSplit(
			[
				flexChild(main, 1, { minWidth: 5, priority: 10 }),
				flexChild(side, 1, { minWidth: 50, priority: 1 }), // will be collapsed
			],
			"|",
		);
		const rows = split.render(25);
		for (const row of rows) expect(row).not.toContain("|");
	});

	it("contains no right-column content when side is collapsed", () => {
		const main = new StubComponent(["MAIN"]);
		const side = new StubComponent(["SECRET"]);
		const split = new HorizontalSplit(
			[flexChild(main, 1, { minWidth: 5, priority: 10 }), flexChild(side, 1, { minWidth: 50, priority: 1 })],
			" ",
		);
		const rows = split.render(25);
		for (const row of rows) expect(row).not.toContain("SECRET");
	});

	it("contains no trailing ANSI SGR state leaking past the row reset", () => {
		// The main column uses its own SGR. The composer must still end
		// each row with \x1b[0m and nothing after it.
		const main = new StubComponent(["\x1b[31mBOLD-RED"]);
		const side = new StubComponent(["x"]);
		const split = new HorizontalSplit(
			[
				flexChild(main, 1, { minWidth: 5, priority: 10 }),
				flexChild(side, 1, { minWidth: 50, priority: 1 }), // collapsed
			],
			" ",
		);
		const rows = split.render(20);
		// Each row ends exactly at the reset; nothing follows.
		for (const row of rows) {
			expect(row.endsWith("\x1b[0m")).toBe(true);
			// No duplicate resets or dangling CSI sequences after the row reset.
			const afterReset = row.slice(row.lastIndexOf("\x1b[0m") + "\x1b[0m".length);
			expect(afterReset).toBe("");
		}
	});
});

describe("HorizontalSplit — ANSI-safe slicing between adjacent children", () => {
	it("does not leak child A's SGR state into child B's column", () => {
		// Child A: red "AAA" (no reset at end). Child B: green "BBB".
		const a = new StubComponent(["\x1b[31mAAA"]);
		const b = new StubComponent(["\x1b[32mBBB"]);
		const split = new HorizontalSplit([fixedChild(a, 3), fixedChild(b, 3)], " ");
		const rows = split.render(7);
		expect(rows[0]).toContain("\x1b[32mBBB");
		const aStart = rows[0]!.indexOf("\x1b[31mAAA");
		const bStart = rows[0]!.indexOf("\x1b[32mBBB");
		const between = rows[0]!.slice(aStart, bStart);
		expect(between).toContain("\x1b[0m");
	});
});
