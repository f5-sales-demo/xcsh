import { describe, expect, it } from "bun:test";
import { HorizontalSplit, TypedEventEmitter } from "@f5-sales-demo/pi-tui";

describe("pi-tui root exports — PR 1 additions", () => {
	it("re-exports TypedEventEmitter from the package root", () => {
		expect(typeof TypedEventEmitter).toBe("function");
	});

	it("re-exports HorizontalSplit from the package root", () => {
		expect(typeof HorizontalSplit).toBe("function");
	});
});
