import { describe, expect, test } from "bun:test";
import { materializeString } from "../src/materialize-string";

describe("materializeString", () => {
	test("preserves UTF-16 code units including lone surrogates", () => {
		const text = `start\uD800middle😀end\uDC00`;
		const copy = materializeString(text);

		expect(copy).toBe(text);
		expect(Array.from({ length: text.length }, (_, index) => copy.charCodeAt(index))).toEqual(
			Array.from({ length: text.length }, (_, index) => text.charCodeAt(index)),
		);
	});

	test("preserves the empty string", () => {
		expect(materializeString("")).toBe("");
	});
});
