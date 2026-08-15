import { describe, expect, test } from "bun:test";
import { type Component, Container, TUI } from "../src/tui";
import { VirtualTerminal } from "./virtual-terminal";

class Lines implements Component {
	constructor(private readonly lines: string[]) {}
	render(): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

describe("TUI viewport observers", () => {
	test("reports marked media lines entering and leaving the visible viewport", async () => {
		const terminal = new VirtualTerminal(40, 2);
		const tui = new TUI(terminal);
		const states: boolean[] = [];
		const observer = tui.registerViewportObserver(visible => states.push(visible));
		tui.addChild(new Lines(["above", `${observer.marker}media`]));
		tui.start();
		await Bun.sleep(0);
		await terminal.flush();
		expect(states.at(-1)).toBe(true);

		tui.addChild(new Lines(["below-1", "below-2", "below-3"]));
		tui.requestRender();
		await Bun.sleep(0);
		await terminal.flush();
		expect(states.at(-1)).toBe(false);
		observer.dispose();
		tui.stop();
	});

	test("unmounts child resources when containers clear", () => {
		const container = new Container();
		let unmounted = false;
		container.addChild({
			render: () => [],
			invalidate: () => {},
			unmount: () => {
				unmounted = true;
			},
		});
		container.clear();
		expect(unmounted).toBe(true);
	});
});
