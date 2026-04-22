import { describe, expect, it } from "bun:test";
import { Box } from "../src/components/box";
import { Text } from "../src/components/text";

describe("Box.setPaddingX", () => {
	it("applies zero left-pad to child output when set to 0", () => {
		const box = new Box(1, 0);
		box.addChild(new Text("abc", 0, 0));
		const withDefault = box.render(20);
		expect(withDefault[0].startsWith(" abc")).toBe(true);

		box.setPaddingX(0);
		const flush = box.render(20);
		expect(flush[0].startsWith("abc")).toBe(true);
		expect(flush[0].startsWith(" abc")).toBe(false);
	});

	it("invalidates the render cache on value change", () => {
		const box = new Box(1, 0);
		box.addChild(new Text("abc", 0, 0));

		const before = box.render(20);
		expect(before[0].startsWith(" abc")).toBe(true);

		box.setPaddingX(2);
		const after = box.render(20);
		expect(after[0].startsWith("  abc")).toBe(true);
	});

	it("is a no-op when value unchanged (returns same cached output)", () => {
		const box = new Box(1, 0);
		box.addChild(new Text("abc", 0, 0));

		const first = box.render(20);
		box.setPaddingX(1);
		const second = box.render(20);
		expect(second).toEqual(first);
	});

	it("reduces child content width by 2 * paddingX", () => {
		const box = new Box(3, 0);
		box.addChild(new Text("x".repeat(20), 0, 0));

		const lines = box.render(10);
		// contentWidth = 10 - 3*2 = 4 → child gets 4 cols → "xxxx"; plus
		// leftPad 3 cols, plus right-fill to full 10 cols → "   xxxx   "
		expect(lines[0]).toBe("   xxxx   ");
	});
});
