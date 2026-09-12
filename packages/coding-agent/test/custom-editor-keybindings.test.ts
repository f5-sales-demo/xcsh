import { describe, expect, it, vi } from "bun:test";
import { defaultEditorTheme } from "../../tui/test/test-themes";
import { CustomEditor } from "../src/modes/components/custom-editor";

function ctrl(key: string): string {
	return String.fromCharCode(key.toLowerCase().charCodeAt(0) & 31);
}

function createEditor() {
	return new CustomEditor(defaultEditorTheme);
}

it("Ctrl+C interrupts by default while Escape only navigates", () => {
	const editor = createEditor();
	const interrupt = vi.fn();
	const navigate = vi.fn();
	editor.onEscape = interrupt;
	editor.onNavigateBack = navigate;
	editor.handleInput("\x1b");
	expect(interrupt).not.toHaveBeenCalled();
	expect(navigate).toHaveBeenCalledTimes(1);
	editor.handleInput(ctrl("c"));
	expect(interrupt).toHaveBeenCalledTimes(1);
	editor.setActionKeys("app.interrupt", ["alt+x"]);
	editor.handleInput(ctrl("c"));
	expect(interrupt).toHaveBeenCalledTimes(1);
	editor.handleInput("\x1bx");
	expect(interrupt).toHaveBeenCalledTimes(2);
});

describe("CustomEditor temporary model selector keybinding", () => {
	it("triggers the temporary selector from a remapped action key instead of Alt+P", () => {
		const editor = createEditor();
		const onSelectModelTemporary = vi.fn();
		editor.onSelectModelTemporary = onSelectModelTemporary;
		editor.setActionKeys("app.model.selectTemporary", ["ctrl+y"]);

		editor.handleInput(ctrl("y"));
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);

		editor.handleInput("\x1bp");
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);
	});

	it("removes the default Alt+P shortcut when the action is disabled", () => {
		const editor = createEditor();
		const onSelectModelTemporary = vi.fn();
		editor.onSelectModelTemporary = onSelectModelTemporary;

		editor.handleInput("\x1bp");
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);

		editor.setActionKeys("app.model.selectTemporary", []);
		editor.handleInput("\x1bp");
		expect(onSelectModelTemporary).toHaveBeenCalledTimes(1);
	});
});
