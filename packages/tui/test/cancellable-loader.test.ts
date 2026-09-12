import { afterEach, expect, it, vi } from "bun:test";
import { CancellableLoader } from "../src/components/cancellable-loader";
import { getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "../src/keybindings";
import type { TUI } from "../src/tui";

const original = getKeybindings();
let loader: CancellableLoader | undefined;
afterEach(() => {
	loader?.dispose();
	setKeybindings(original);
});

function createLoader() {
	loader = new CancellableLoader(
		{ requestRender() {} } as TUI,
		text => text,
		text => text,
	);
	return loader;
}

it("Escape does not interrupt loading; default Ctrl+C requests interruption only once", () => {
	setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
	const view = createLoader();
	view.onAbort = vi.fn();
	view.handleInput("\x1b");
	expect(view.signal.aborted).toBe(false);
	view.handleInput("\x03");
	view.handleInput("\x03");
	expect(view.signal.aborted).toBe(true);
	expect(view.onAbort).toHaveBeenCalledTimes(1);
});

it("honors an application interrupt override, including explicit disabling", () => {
	const bindings = new KeybindingsManager({ ...TUI_KEYBINDINGS, "app.interrupt": { defaultKeys: "alt+x" } });
	setKeybindings(bindings);
	const view = createLoader();
	view.handleInput("\x03");
	expect(view.aborted).toBe(false);
	bindings.setUserBindings({ "app.interrupt": [] });
	view.handleInput("\x1bx");
	expect(view.aborted).toBe(false);
	bindings.setUserBindings({});
	view.handleInput("\x1bx");
	expect(view.aborted).toBe(true);
});
