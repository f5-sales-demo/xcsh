import { beforeAll, describe, expect, it, vi } from "bun:test";
import { Box, Text, type TUI } from "@f5xc-salesdemos/pi-tui";
import { GutterBlock } from "../src/modes/components/gutter-block";
import { initTheme } from "../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

function mockTUI(): TUI {
	return { requestRender: vi.fn() } as unknown as TUI;
}

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// End-to-end reproduction of xcsh#153: a real Box(paddingY=1) wrapping a real
// Text emits ANSI-background-colored empty lines as padding. The GutterBlock
// must still place its indicator on the line containing the actual content —
// not on the invisible padding line above it.
describe("GutterBlock + Box(paddingY=1) integration (xcsh#153)", () => {
	it("places the ● indicator on the content line, not on the Box's top padding line", () => {
		const ui = mockTUI();
		const bgFn = (s: string) => `\x1b[48;5;236m${s}\x1b[0m`;
		const box = new Box(1, 1, bgFn);
		box.addChild(new Text("Title", 1, 0));

		const gutter = new GutterBlock(ui, box, {
			symbol: "●",
			activeColorFn: s => s,
			doneColorFn: s => s,
			animated: false,
		});

		const lines = gutter.render(40);
		// Box emits: [top-pad, content, bottom-pad] — 3 lines minimum.
		expect(lines.length).toBeGreaterThanOrEqual(3);

		// Locate the line that actually contains the visible "Title" text.
		const titleIdx = lines.findIndex(line => stripAnsi(line).includes("Title"));
		expect(titleIdx).toBeGreaterThan(-1);

		// The indicator must be on that line, not above it.
		expect(lines[titleIdx]).toStartWith("● ");

		// Any line before the title is a padding line — it must carry the
		// continuation pad, never the indicator.
		for (let i = 0; i < titleIdx; i++) {
			expect(lines[i]).not.toStartWith("● ");
			expect(lines[i]).toStartWith("  ");
		}
	});

	// The 9 boxed tool-output call sites in modes/components/ were flipped to
	// paddingY=0 so no background-colored blank rows render above or below the
	// content. This test locks the invariant: Box(_, 0, bgFn) with a single Text
	// child renders exactly one content line — no leading/trailing padding.
	it("Box(paddingY=0) wrapping Text renders exactly one content line, no padding rows", () => {
		const bgFn = (s: string) => `\x1b[48;5;236m${s}\x1b[0m`;
		const box = new Box(1, 0, bgFn);
		box.addChild(new Text("Content", 1, 0));

		const lines = box.render(40);
		expect(lines).toHaveLength(1);
		expect(stripAnsi(lines[0])).toContain("Content");
	});
});
