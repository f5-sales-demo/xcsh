import { describe, expect, it } from "bun:test";
import { parseBinding, parseBindings } from "@f5-sales-demo/pi-tui/chord-parser";

describe("parseBinding — single stroke", () => {
	it("parses a plain single-stroke binding", () => {
		const result = parseBinding("ctrl+b");
		expect(result).toEqual({ ok: true, sequence: ["ctrl+b"] });
	});

	it("parses a bare key as single-stroke", () => {
		expect(parseBinding("escape")).toEqual({ ok: true, sequence: ["escape"] });
	});
});

describe("parseBinding — chord", () => {
	it("parses a two-key chord", () => {
		expect(parseBinding("ctrl+x b")).toEqual({
			ok: true,
			sequence: ["ctrl+x", "b"],
		});
	});

	it("normalizes whitespace between tokens", () => {
		expect(parseBinding("  ctrl+x    b  ")).toEqual({
			ok: true,
			sequence: ["ctrl+x", "b"],
		});
	});
});

describe("parseBinding — rejection", () => {
	it("rejects 3+ keystrokes", () => {
		const result = parseBinding("ctrl+x ctrl+f g");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("at most 2");
			expect(result.error.input).toBe("ctrl+x ctrl+f g");
		}
	});

	it("rejects empty input", () => {
		expect(parseBinding("").ok).toBe(false);
		expect(parseBinding("   ").ok).toBe(false);
	});
});

describe("parseBindings — map action to parsed sequences", () => {
	it("parses a map of action → binding string", () => {
		const result = parseBindings({
			"app.sidebar.toggle": "ctrl+x b",
			"app.exit": "ctrl+c",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.bindings).toEqual([
				{ action: "app.sidebar.toggle", sequence: ["ctrl+x", "b"] },
				{ action: "app.exit", sequence: ["ctrl+c"] },
			]);
		}
	});

	it("supports multiple sequences per action (array of binding strings)", () => {
		const result = parseBindings({
			"app.tools.expand": ["ctrl+o", "f4"],
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.bindings).toEqual([
				{ action: "app.tools.expand", sequence: ["ctrl+o"] },
				{ action: "app.tools.expand", sequence: ["f4"] },
			]);
		}
	});

	it("returns the first error encountered", () => {
		const result = parseBindings({
			"app.bad": "a b c",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.input).toBe("a b c");
		}
	});
});
