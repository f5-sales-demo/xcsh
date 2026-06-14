import { describe, expect, it, vi } from "bun:test";
import { TUI } from "@f5xc-salesdemos/pi-tui";
import { VirtualTerminal } from "./virtual-terminal";

// The credential-fix flow suspends the UI to run a cooked-mode subprocess
// (`aws sso login`). It MUST drain pending terminal input while still in raw
// mode before stopping — otherwise a late OSC 11 poll response is echoed by the
// terminal as gibberish during the cooked-mode window (the v19.29.3 residual).
describe("TUI.suspendForSubprocess", () => {
	it("drains input before stopping so a pending probe response is consumed in raw mode", async () => {
		const term = new VirtualTerminal(80, 24);
		const tui = new TUI(term);
		tui.start();
		await Bun.sleep(0);

		const order: string[] = [];
		vi.spyOn(term, "drainInput").mockImplementation(async () => {
			order.push("drain");
		});
		vi.spyOn(term, "stop").mockImplementation(() => {
			order.push("stop");
		});

		await tui.suspendForSubprocess();

		expect(order).toEqual(["drain", "stop"]);
		vi.restoreAllMocks();
	});
});
