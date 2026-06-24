import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@f5xc-salesdemos/pi-tui";
import { getThemeByName } from "@f5xc-salesdemos/xcsh/modes/theme/theme";
import { renderOutputBlock } from "@f5xc-salesdemos/xcsh/tui/output-block";

const WIDTH = 40;
// A single diagram-ish line far wider than the inner content width.
const WIDE = `┌── Client ──┐${"─".repeat(120)}┐ 11. Connect to Selected Endpoint`;
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("renderOutputBlock content overflow", () => {
	it("word-wraps wide content by default (multiple rows)", async () => {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const out = renderOutputBlock({ width: WIDTH, sections: [{ lines: [WIDE] }] }, theme);
		// top + (>1 wrapped content rows) + bottom
		expect(out.length).toBeGreaterThan(3);
	});

	it("clips wide content to one row when wrapContent is false (no reflow)", async () => {
		const theme = (await getThemeByName("xcsh-dark"))!;
		const out = renderOutputBlock({ width: WIDTH, sections: [{ lines: [WIDE] }], wrapContent: false }, theme);
		// top + exactly ONE content row + bottom
		expect(out.length).toBe(3);
		// every emitted row is exactly the block width — the box stays aligned
		for (const row of out) expect(visibleWidth(row)).toBe(WIDTH);
		// the content row preserves the left of the diagram (not a reflowed remainder)
		expect(strip(out[1]!)).toContain("┌── Client");
		expect(strip(out[1]!)).not.toContain("Endpoint"); // far-right was clipped, not wrapped to a new line
		// clean clip: no trailing ellipsis column
		expect(strip(out[1]!)).not.toContain("…");
		expect(strip(out[1]!)).not.toMatch(/\.\.\.$/);
	});
});
