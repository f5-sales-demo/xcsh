import { describe, expect, it } from "bun:test";
import { parseBinding } from "@f5xc-salesdemos/pi-tui/chord-parser";

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
