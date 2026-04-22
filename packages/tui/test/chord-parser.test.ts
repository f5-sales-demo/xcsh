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
