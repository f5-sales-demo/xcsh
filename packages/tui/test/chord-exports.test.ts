import { describe, expect, it } from "bun:test";
import { ChordDispatcher, parseBinding } from "@f5-sales-demo/pi-tui";

describe("pi-tui root exports", () => {
	it("re-exports chord parser and dispatcher", () => {
		expect(typeof parseBinding).toBe("function");
		expect(typeof ChordDispatcher).toBe("function");
	});
});
