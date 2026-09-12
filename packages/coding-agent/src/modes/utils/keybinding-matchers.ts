import { getKeybindings, matchesKey } from "@f5-sales-demo/pi-tui";
import { formatKeyHints } from "../../config/keybindings";

export function appInterruptHint(): string {
	const bindings = getKeybindings();
	const keys = bindings.getDefinition("app.interrupt") ? bindings.getKeys("app.interrupt") : ["ctrl+c" as const];
	return keys.length ? `${formatKeyHints(keys)}: interrupt` : "Interruption disabled";
}

/**
 * Match the coding-agent interrupt key.
 *
 * Interactive mode installs a keybinding manager that exposes `app.interrupt`
 * globally, but some isolated component tests still run with only TUI
 * keybindings registered. In that case, fall back to Ctrl+C; an explicitly
 * disabled registered binding stays disabled.
 */
export function matchesAppInterrupt(data: string): boolean {
	const keybindings = getKeybindings();
	if (keybindings.getDefinition("app.interrupt")) {
		return keybindings.matches(data, "app.interrupt");
	}
	return matchesKey(data, "ctrl+c");
}

export function matchesSelectCancel(data: string): boolean {
	return getKeybindings().matches(data, "tui.select.cancel");
}

export function matchesAppExternalEditor(data: string): boolean {
	const keybindings = getKeybindings();
	if (keybindings.getDefinition("app.editor.external")) {
		return keybindings.matches(data, "app.editor.external");
	}
	return matchesKey(data, "ctrl+g");
}
