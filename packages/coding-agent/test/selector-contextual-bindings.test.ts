import { afterEach, expect, test, vi } from "bun:test";
import { getKeybindings, setKeybindings } from "@f5-sales-demo/pi-tui";
import { KeybindingsManager } from "../src/config/keybindings";
import { ConnectionChoiceComponent } from "../src/modes/components/selector-frame";
import { initTheme } from "../src/modes/theme/theme";

const original = getKeybindings();
afterEach(() => setKeybindings(original));
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
