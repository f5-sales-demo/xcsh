import { describe, expect, it } from "bun:test";
import { renderMermaidAsciiSafe } from "../src/mermaid-ascii";

/**
 * Guards the beautiful-mermaid patch (patches/beautiful-mermaid@1.1.3.patch):
 * node labels must be vertically centered with equal-or-greater padding below,
 * never top-heavy. Without the patch, tall boxes drop their label too low.
 */
describe("node label vertical centering", () => {
	it("never places a label top-heavy in a tall box", () => {
		// A short label sharing a rank with a tall 5-line sibling forces a tall box A.
		const out = renderMermaidAsciiSafe("graph LR\nA[Client<br/>info] --> B[L0<br/>L1<br/>L2<br/>L3<br/>L4]", {
			paddingX: 2,
			paddingY: 1,
		});
		expect(out).not.toBeNull();
		const lines = out!.split("\n");
		const top = lines.findIndex(l => l[0] === "┌");
		const bottom = lines.findIndex((l, i) => i > top && l[0] === "└");
		const firstLabel = lines.findIndex(l => l.includes("Client"));
		const lastLabel = lines
			.map((l, i) => (l.includes("info") ? i : -1))
			.filter(i => i >= 0)
			.pop()!;

		const above = firstLabel - (top + 1);
		const below = bottom - 1 - lastLabel;
		expect(above).toBeGreaterThanOrEqual(0);
		expect(above).toBeLessThanOrEqual(below); // centered, biased slightly high — not top-heavy
	});
});
