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
