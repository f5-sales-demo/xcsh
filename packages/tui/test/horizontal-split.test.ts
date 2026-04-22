import { describe, expect, it } from "bun:test";
import type { Component } from "@f5xc-salesdemos/pi-tui";
import { HorizontalSplit, type SplitChild } from "@f5xc-salesdemos/pi-tui/horizontal-split";

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
		expect(rows).toEqual(["AAA|BBBBB\x1b[0m"]);
	});

	it("defaults the separator to a single space when omitted", () => {
		const a = new StubComponent(["AAA"]);
		const b = new StubComponent(["BBB"]);
		const split = new HorizontalSplit([fixedChild(a, 3), fixedChild(b, 3)]);
		const rows = split.render(7);
		expect(rows[0]).toBe("AAA BBB\x1b[0m");
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
