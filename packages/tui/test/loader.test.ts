import { describe, expect, it } from "bun:test";
import { TUI } from "@f5-sales-demo/pi-tui";
import { Loader } from "@f5-sales-demo/pi-tui/components/loader";
import { visibleWidth } from "@f5-sales-demo/pi-tui/utils";
import { VirtualTerminal } from "./virtual-terminal";

describe("Loader component", () => {
	it("renders flush to col 0 — no leading space from default paddingX", async () => {
		const term = new VirtualTerminal(40, 4);
		const tui = new TUI(term);
		const loader = new Loader(
			tui,
			text => text,
			text => text,
			"Loading…",
			["⠸"],
		);
		tui.addChild(loader);
		tui.start();
		await Bun.sleep(0);
		await term.flush();

		const viewport = term.getViewport();
		// Find the first non-empty line and assert it starts with the spinner glyph,
		// not a space.
		const firstNonEmpty = viewport.find(l => l.trim().length > 0);
		expect(firstNonEmpty?.startsWith(" ")).toBe(false);
		expect(firstNonEmpty).toContain("⠸");

		loader.stop();
		tui.stop();
	});

	it("clamps rendered lines to terminal width", async () => {
		const term = new VirtualTerminal(1, 4);
		const tui = new TUI(term);
		const loader = new Loader(
			tui,
			text => text,
			text => text,
			"Checking",
			["⠸"],
		);
		tui.addChild(loader);

		tui.start();
		await Bun.sleep(0);
		await term.flush();

		for (const line of term.getViewport()) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(1);
		}

		loader.stop();
		tui.stop();
	});
});
