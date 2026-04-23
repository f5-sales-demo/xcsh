import { describe, expect, test } from "bun:test";
import { hexToBgAnsi, hexToFgAnsi, hexToRgb } from "../../../../src/modes/components/status-line/hex-ansi";

describe("hexToRgb", () => {
	test("parses hex with leading #", () => {
		expect(hexToRgb("#0d1b3e")).toEqual([13, 27, 62]);
	});

	test("parses hex without leading #", () => {
		expect(hexToRgb("0d1b3e")).toEqual([13, 27, 62]);
	});

	test("parses pure white", () => {
		expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
	});

	test("parses pure black", () => {
		expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
	});

	test("throws on non-hex characters", () => {
		expect(() => hexToRgb("#gghhii")).toThrow();
	});

	test("throws on wrong length (5 chars)", () => {
		expect(() => hexToRgb("#12345")).toThrow();
	});

	test("throws on wrong length (7 chars)", () => {
		expect(() => hexToRgb("#1234567")).toThrow();
	});

	test("throws on empty string", () => {
		expect(() => hexToRgb("")).toThrow();
	});
});

describe("hexToFgAnsi", () => {
	test("produces 24-bit truecolor foreground escape", () => {
		expect(hexToFgAnsi("#0d1b3e")).toBe("\x1b[38;2;13;27;62m");
	});

	test("handles pure white", () => {
		expect(hexToFgAnsi("#ffffff")).toBe("\x1b[38;2;255;255;255m");
	});

	test("handles pure black", () => {
		expect(hexToFgAnsi("#000000")).toBe("\x1b[38;2;0;0;0m");
	});
});

describe("hexToBgAnsi", () => {
	test("produces 24-bit truecolor background escape", () => {
		expect(hexToBgAnsi("#0d1b3e")).toBe("\x1b[48;2;13;27;62m");
	});

	test("handles pure white", () => {
		expect(hexToBgAnsi("#ffffff")).toBe("\x1b[48;2;255;255;255m");
	});

	test("bg differs from fg only in the 38→48 parameter", () => {
		const fg = hexToFgAnsi("#f9a825");
		const bg = hexToBgAnsi("#f9a825");
		expect(bg).toBe(fg.replace("\x1b[38;", "\x1b[48;"));
	});
});
