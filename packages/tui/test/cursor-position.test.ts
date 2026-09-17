import { describe, expect, it } from "bun:test";
import { type Component, CURSOR_MARKER, TUI } from "@f5-sales-demo/pi-tui";
import { useStandaloneTerminalEnvironment, VirtualTerminal } from "./virtual-terminal";

useStandaloneTerminalEnvironment();

class CursorRowsComponent implements Component {
	#lines: string[];

	constructor(lines: string[]) {
		this.#lines = [...lines];
	}

	setLines(lines: string[]): void {
		this.#lines = [...lines];
	}

	invalidate(): void {}

	render(): string[] {
		return [...this.#lines];
	}
}

async function settle(term: VirtualTerminal): Promise<void> {
	await Bun.sleep(0);
	await term.flush();
}

describe("TUI hardware cursor positioning", () => {
	for (const showHardwareCursor of [true, false]) {
		it(`preserves ASCII cursor coordinates across rows with hardware cursor ${showHardwareCursor ? "shown" : "hidden"}`, async () => {
			const term = new VirtualTerminal(12, 6);
			const component = new CursorRowsComponent(["first row", "second row", `end${CURSOR_MARKER}`]);
			const tui = new TUI(term, showHardwareCursor);
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);
				expect(term.getCursorPosition()).toEqual({ row: 2, column: 3 });

				component.setLines(["first row", `mid${CURSOR_MARKER}dle`, "third row"]);
				tui.requestRender();
				await settle(term);
				expect(term.getCursorPosition()).toEqual({ row: 1, column: 3 });

				component.setLines(["first row", `${CURSOR_MARKER}boundary`, "third row"]);
				tui.requestRender();
				await settle(term);
				expect(term.getCursorPosition()).toEqual({ row: 1, column: 0 });
			} finally {
				tui.stop();
			}
		});
	}

	it("uses visual columns for wide Unicode graphemes", async () => {
		const term = new VirtualTerminal(12, 6);
		const component = new CursorRowsComponent(["first", `界a${CURSOR_MARKER}🙂z`, "third"]);
		const tui = new TUI(term, true);
		tui.addChild(component);

		try {
			tui.start();
			await settle(term);
			expect(term.getCursorPosition()).toEqual({ row: 1, column: 3 });
		} finally {
			tui.stop();
		}
	});

	it("keeps multiline cursor coordinates through width changes", async () => {
		const term = new VirtualTerminal(12, 6);
		const component = new CursorRowsComponent(["row zero", "row one", `four${CURSOR_MARKER}567`]);
		const tui = new TUI(term, true);
		tui.addChild(component);

		try {
			tui.start();
			await settle(term);
			expect(term.getCursorPosition()).toEqual({ row: 2, column: 4 });

			component.setLines(["row 0", "row 1", `ab${CURSOR_MARKER}cdefg`]);
			term.resize(8, 6);
			await settle(term);
			expect(term.getCursorPosition()).toEqual({ row: 2, column: 2 });
		} finally {
			tui.stop();
		}
	});

	it("preserves the cursor column when a visible row is truncated", async () => {
		const term = new VirtualTerminal(10, 4);
		const component = new CursorRowsComponent([`abcdefg${CURSOR_MARKER}hijklmnop`]);
		const tui = new TUI(term, true);
		tui.addChild(component);

		try {
			tui.start();
			await settle(term);
			expect(term.getViewport()[0]).toBe("abcdefghij");
			expect(term.getCursorPosition()).toEqual({ row: 0, column: 7 });
		} finally {
			tui.stop();
		}
	});

	it("bounds the cursor before the terminal's one-cell right gutter", async () => {
		const term = new VirtualTerminal(10, 4);
		const component = new CursorRowsComponent([`0123456789${CURSOR_MARKER}`]);
		const tui = new TUI(term, true);
		tui.addChild(component);

		try {
			tui.start();
			await settle(term);
			expect(term.getCursorPosition()).toEqual({ row: 0, column: 9 });
		} finally {
			tui.stop();
		}
	});

	it("does not place a clamped cursor inside a wide grapheme at the gutter", async () => {
		const term = new VirtualTerminal(10, 4);
		const component = new CursorRowsComponent([`12345678界${CURSOR_MARKER}tail`]);
		const tui = new TUI(term, true);
		tui.addChild(component);

		try {
			tui.start();
			await settle(term);
			expect(term.getCursorPosition()).toEqual({ row: 0, column: 8 });
		} finally {
			tui.stop();
		}
	});

	for (const [name, prefix] of [
		["ANSI", "\x1b[31m".repeat(20_000)],
		["OSC", `\x1b]8;;https://example.com/${"a".repeat(70_000)}\x07`],
	] as const) {
		it(`preserves the cursor through a pathological ${name} prefix`, async () => {
			const term = new VirtualTerminal(10, 4);
			const component = new CursorRowsComponent([`${prefix}abc${CURSOR_MARKER}defghijkl`]);
			const tui = new TUI(term, true);
			tui.addChild(component);

			try {
				tui.start();
				await settle(term);
				expect(term.getCursorPosition()).toEqual({ row: 0, column: 3 });
			} finally {
				tui.stop();
			}
		});
	}
});
