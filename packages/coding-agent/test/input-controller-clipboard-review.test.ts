import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import type { Component } from "@f5-sales-demo/pi-tui";
import { InputController } from "../src/modes/controllers/input-controller";
import { setTheme } from "../src/modes/theme/theme";
import type { InteractiveModeContext } from "../src/modes/types";
import * as clipboard from "../src/utils/clipboard";

beforeAll(async () => setTheme("xcsh-dark"));
afterEach(() => vi.restoreAllMocks());

function harness() {
	let text = "first line\nsecret draft";
	let component: Component | undefined;
	const editor = {
		getCursor: () => ({ line: 1, column: 3 }),
		getLines: () => text.split("\n"),
		getText: () => text,
	};
	const ctx = {
		editor,
		sessionManager: { getSessionId: () => "clipboard-session" },
		showStatus: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (factory: any) =>
			new Promise(resolve => {
				component = factory({ terminal: { rows: 32 }, requestRender() {} }, {}, {}, resolve);
			}),
	} as unknown as InteractiveModeContext;
	return {
		controller: new InputController(ctx),
		ctx,
		text: () => (component ? Bun.stripANSI(component.render(100).join("\n")) : ""),
		input: (key: string) => component?.handleInput?.(key),
		change: (value: string) => {
			text = value;
		},
	};
}

async function waitFor(predicate: () => boolean) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await Bun.sleep(5);
	}
	throw new Error("Clipboard review state not reached");
}

describe("editor clipboard actions", () => {
	it.each([false, true])("reviews the current line without exposing its text (confirm: %s)", async confirm => {
		const copy = vi
			.spyOn(clipboard, "copyToClipboardWithDelivery")
			.mockResolvedValue({ ok: true, delivery: "copied" });
		const h = harness();
		const pending = h.controller.handleCopyCurrentLine();
		await waitFor(() => h.text().includes("Review editor line copy"));
		expect(h.text()).toContain("12 UTF-8 bytes");
		expect(h.text()).not.toContain("secret draft");
		expect(copy).not.toHaveBeenCalled();
		if (confirm) h.input("\x1b[B");
		h.input("\r");
		await pending;
		expect(copy).toHaveBeenCalledTimes(confirm ? 1 : 0);
		if (confirm) expect(copy).toHaveBeenCalledWith("secret draft");
	});

	it("revalidates the complete prompt before clipboard delivery", async () => {
		const copy = vi
			.spyOn(clipboard, "copyToClipboardWithDelivery")
			.mockResolvedValue({ ok: true, delivery: "copied" });
		const h = harness();
		const pending = h.controller.handleCopyPrompt();
		await waitFor(() => h.text().includes("Review editor prompt copy"));
		h.change("changed draft");
		h.input("\x1b[B");
		h.input("\r");
		await waitFor(() => h.text().includes("proposal changed"));
		expect(copy).not.toHaveBeenCalled();
		h.input("\r");
		await pending;
	});
});
