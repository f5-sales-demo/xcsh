import { describe, expect, it } from "bun:test";
import { type Component, TUI } from "@f5-sales-demo/pi-tui";
import type { Terminal, TerminalAppearance } from "@f5-sales-demo/pi-tui/terminal";

class CaptureTerminal implements Terminal {
	writes: string[] = [];
	#onDisconnect?: () => void;
	#columns: number;
	#rows: number;

	constructor(columns = 80, rows = 4) {
		this.#columns = columns;
		this.#rows = rows;
	}

	get columns(): number {
		return this.#columns;
	}

	get rows(): number {
		return this.#rows;
	}

	get kittyProtocolActive(): boolean {
		return false;
	}

	get appearance(): TerminalAppearance | undefined {
		return undefined;
	}

	start(_onInput?: (data: string) => void, _onResize?: () => void, onDisconnect?: () => void): void {
		this.#onDisconnect = onDisconnect;
	}
	stop(): void {}
	disconnect(): void {
		this.#onDisconnect?.();
	}
	async drainInput(): Promise<void> {}
	write(data: string): void {
		this.writes.push(data);
	}
	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(): void {}
	setProgress(): void {}
	onAppearanceChange(): void {}
}

class RawLinesComponent implements Component {
	#lines: string[];
	renderCount = 0;

	constructor(lines: string[]) {
		this.#lines = lines;
	}

	invalidate(): void {}

	render(): string[] {
		this.renderCount++;
		return this.#lines;
	}
}

async function settle(): Promise<void> {
	await Bun.sleep(0);
}

describe("issue #2045: renderer bounds oversized rows", () => {
	it("preserves visible text after pathological zero-width ANSI prefixes", async () => {
		const term = new CaptureTerminal(80, 4);
		const tui = new TUI(term);
		const line = `${"\x1b[31m".repeat(20_000)}payload`;

		tui.addChild(new RawLinesComponent([line]));
		try {
			tui.start();
			await settle();
		} finally {
			tui.stop();
		}

		const rendered = term.writes.join("");
		expect(rendered).toContain("payload");
		expect(rendered.length).toBeLessThan(12_000);
	});

	it("preserves visible text after oversized OSC hyperlink prefixes", async () => {
		const term = new CaptureTerminal(80, 4);
		const tui = new TUI(term);
		const line = `\x1b]8;;https://example.com/${"a".repeat(70_000)}\x07link-label\x1b]8;;\x07`;

		tui.addChild(new RawLinesComponent([line]));
		try {
			tui.start();
			await settle();
		} finally {
			tui.stop();
		}

		const rendered = term.writes.join("");
		expect(rendered).toContain("link-label");
		expect(rendered.length).toBeLessThan(12_000);
	});

	it("preserves OSC 66 text-sizing payloads at the start of long rows", async () => {
		const term = new CaptureTerminal(80, 4);
		const tui = new TUI(term);
		const visibleText = "H".repeat(70);
		const line = `\x1b]66;s=1;${visibleText}\x1b\\${"\x1b[31m".repeat(20_000)}`;

		tui.addChild(new RawLinesComponent([line]));
		try {
			tui.start();
			await settle();
		} finally {
			tui.stop();
		}

		const rendered = term.writes.join("");
		expect(rendered).toContain(visibleText);
	});

	it("stops rendering synchronously when the terminal disconnects", async () => {
		const term = new CaptureTerminal(80, 4);
		const tui = new TUI(term);
		const component = new RawLinesComponent(["before disconnect"]);
		tui.addChild(component);
		tui.start();
		await settle();
		const rendersBeforeDisconnect = component.renderCount;

		term.disconnect();
		tui.requestRender(true);
		await settle();

		expect(component.renderCount).toBe(rendersBeforeDisconnect);
	});
});
