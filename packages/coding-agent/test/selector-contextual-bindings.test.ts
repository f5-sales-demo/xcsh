import { afterEach, expect, test, vi } from "bun:test";
import { getKeybindings, setKeybindings } from "@f5-sales-demo/pi-tui";
import { KeybindingsManager } from "../src/config/keybindings";
import { ConnectionChoiceComponent } from "../src/modes/components/selector-frame";
import { initTheme } from "../src/modes/theme/theme";
import { appInterruptHint, matchesAppInterrupt } from "../src/modes/utils/keybinding-matchers";

const original = getKeybindings();
afterEach(() => setKeybindings(original));
test("default interrupt is Ctrl+C and explicitly disabled interrupt remains disabled", () => {
	const keys = KeybindingsManager.inMemory();
	setKeybindings(keys);
	expect(matchesAppInterrupt("\x03")).toBe(true);
	expect(matchesAppInterrupt("\x1b")).toBe(false);
	expect(appInterruptHint()).toBe("Ctrl+C: interrupt");
	keys.setUserBindings({ "app.interrupt": "ctrl+x" });
	expect(matchesAppInterrupt("\x03")).toBe(false);
	expect(matchesAppInterrupt("\x18")).toBe(true);
	expect(appInterruptHint()).toBe("Ctrl+X: interrupt");
	keys.setUserBindings({ "app.interrupt": [] });
	expect(matchesAppInterrupt("\x03")).toBe(false);
	expect(appInterruptHint()).toBe("Interruption disabled");
});
test("ordinary menu controls are implicit and Ctrl+C is not Back", async () => {
	await initTheme();
	setKeybindings(KeybindingsManager.inMemory());
	const selected = vi.fn();
	const cancelled = vi.fn();
	const selector = new ConnectionChoiceComponent("Connection", "", [{ label: "Browse models" }], selected, cancelled);
	const text = Bun.stripANSI(selector.render(80).join("\n"));
	expect(text).not.toContain("Enter:");
	expect(text).not.toContain("navigate");
	expect(text).toContain("Esc: back");
	selector.handleInput("\x03");
	expect(cancelled).not.toHaveBeenCalled();
	selector.handleInput("\r");
	expect(selected).toHaveBeenCalledWith(0);
	selector.handleInput("\x1b");
	expect(cancelled).toHaveBeenCalledTimes(1);
});
test("footer and navigation honor remapped selector bindings", async () => {
	await initTheme();
	const keys = KeybindingsManager.inMemory();
	keys.setUserBindings({ "tui.select.down": "ctrl+n", "tui.select.confirm": "ctrl+y", "tui.select.cancel": "ctrl+x" });
	setKeybindings(keys);
	const selected = vi.fn();
	const cancelled = vi.fn();
	const selector = new ConnectionChoiceComponent(
		"Provider connected",
		"Credentials saved",
		[{ label: "Browse models" }, { label: "Done" }],
		selected,
		cancelled,
	);
	const text = Bun.stripANSI(selector.render(80).join("\n"));
	expect(text).toContain("Ctrl+N");
	expect(text).toContain("Ctrl+Y: select");
	expect(text).toContain("Ctrl+X: back");
	selector.handleInput("\r");
	expect(selected).not.toHaveBeenCalled();
	selector.handleInput("\x0e");
	selector.handleInput("\x19");
	expect(selected).toHaveBeenCalledWith(1);
	selector.handleInput("\x18");
	expect(cancelled).toHaveBeenCalledTimes(1);
});
