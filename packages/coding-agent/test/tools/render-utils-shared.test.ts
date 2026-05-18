import { describe, expect, it } from "bun:test";
import { getThemeByName } from "../../src/modes/theme/theme";
import { addSection, formatTimestamp, stripEmpty } from "../../src/tools/render-utils";

describe("stripEmpty", () => {
	it("removes null values from objects", () => {
		expect(stripEmpty({ a: null, b: "value" })).toEqual({ b: "value" });
	});
	it("removes empty string values", () => {
		expect(stripEmpty({ a: "", b: "value" })).toEqual({ b: "value" });
	});
	it("removes empty arrays", () => {
		expect(stripEmpty({ a: [], b: [1] })).toEqual({ b: [1] });
	});
	it("preserves empty objects (protobuf oneof presence markers)", () => {
		expect(stripEmpty({ a: {} })).toEqual({ a: {} });
	});
	it("recursively strips nested nulls", () => {
		expect(stripEmpty({ outer: { inner: null, keep: "x" } })).toEqual({ outer: { keep: "x" } });
	});
	it("strips nulls from arrays", () => {
		expect(stripEmpty([null, "a", null])).toEqual(["a"]);
	});
	it("returns non-object primitives unchanged", () => {
		expect(stripEmpty("hello")).toBe("hello");
		expect(stripEmpty(42)).toBe(42);
	});
	it("returns null when all fields are empty", () => {
		expect(stripEmpty({ a: null, b: "" })).toBeNull();
	});
});

describe("formatTimestamp", () => {
	it("converts ISO 8601 to readable UTC format", () => {
		expect(formatTimestamp("2026-05-18T14:32:00Z")).toBe("2026-05-18 14:32 UTC");
	});
	it("handles millisecond precision", () => {
		expect(formatTimestamp("2026-05-18T14:32:00.000Z")).toBe("2026-05-18 14:32 UTC");
	});
});

describe("addSection", () => {
	it("appends a labeled section with lines", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const sections: Array<{ label?: string; lines: string[] }> = [];
		addSection(sections, "Results", ["line1", "line2"], theme!);
		expect(sections).toHaveLength(1);
		expect(sections[0].lines).toHaveLength(2);
		expect(sections[0].label).toBeTruthy();
	});
	it("truncates to maxLines and appends ellipsis line", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const sections: Array<{ label?: string; lines: string[] }> = [];
		addSection(sections, "Section", ["a", "b", "c", "d", "e"], theme!, 3);
		expect(sections[0].lines).toHaveLength(4);
	});
	it("does not truncate when lines count is within maxLines", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const sections: Array<{ label?: string; lines: string[] }> = [];
		addSection(sections, "Section", ["a", "b"], theme!, 5);
		expect(sections[0].lines).toHaveLength(2);
	});
});
