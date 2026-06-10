import { t } from "@f5xc-salesdemos/pi-utils";
import type { AppKeybinding, KeybindingsManager } from "../../config/keybindings";

export interface HotkeysMarkdownBindings {
	keybindings: Pick<KeybindingsManager, "getDisplayString">;
}

function appKey(bindings: HotkeysMarkdownBindings, action: AppKeybinding): string {
	return bindings.keybindings.getDisplayString(action) || "Disabled";
}

export function buildHotkeysMarkdown(bindings: HotkeysMarkdownBindings): string {
	return [
		`**${t("hotkeys.navigation.title")}**`,
		"| Key | Action |",
		"|-----|--------|",
		`| \`Arrow keys\` | ${t("hotkeys.navigation.moveCursor")} |`,
		`| \`Option+Left/Right\` | ${t("hotkeys.navigation.moveByWord")} |`,
		`| \`Ctrl+A\` / \`Home\` / \`Cmd+Left\` | ${t("hotkeys.navigation.startOfLine")} |`,
		`| \`Ctrl+E\` / \`End\` / \`Cmd+Right\` | ${t("hotkeys.navigation.endOfLine")} |`,
		"",
		`**${t("hotkeys.editing.title")}**`,
		"| Key | Action |",
		"|-----|--------|",
		`| \`Enter\` | ${t("hotkeys.editing.sendMessage")} |`,
		`| \`Shift+Enter\` / \`Alt+Enter\` | ${t("hotkeys.editing.newLine")} |`,
		`| \`Ctrl+W\` / \`Option+Backspace\` | ${t("hotkeys.editing.deleteWordBackwards")} |`,
		`| \`Ctrl+U\` | ${t("hotkeys.editing.deleteToStart")} |`,
		`| \`Ctrl+K\` | ${t("hotkeys.editing.deleteToEnd")} |`,
		`| \`${appKey(bindings, "app.clipboard.copyLine")}\` | ${t("hotkeys.editing.copyLine")} |`,
		`| \`${appKey(bindings, "app.clipboard.copyPrompt")}\` | ${t("hotkeys.editing.copyPrompt")} |`,
		"",
		`**${t("hotkeys.other.title")}**`,
		"| Key | Action |",
		"|-----|--------|",
		`| \`Tab\` | ${t("hotkeys.other.pathCompletion")} |`,
		`| \`${appKey(bindings, "app.interrupt")}\` | ${t("hotkeys.other.cancelInterrupt")} |`,
		`| \`${appKey(bindings, "app.clear")}\` | ${t("hotkeys.other.clearExit")} |`,
		`| \`${appKey(bindings, "app.exit")}\` | ${t("hotkeys.other.exit")} |`,
		`| \`${appKey(bindings, "app.suspend")}\` | ${t("hotkeys.other.suspend")} |`,
		`| \`${appKey(bindings, "app.thinking.cycle")}\` | ${t("hotkeys.other.cycleThinking")} |`,
		`| \`${appKey(bindings, "app.model.cycleForward")}\` | ${t("hotkeys.other.cycleModelsForward")} |`,
		`| \`${appKey(bindings, "app.model.cycleBackward")}\` | ${t("hotkeys.other.cycleModelsBackward")} |`,
		`| \`${appKey(bindings, "app.model.selectTemporary")}\` | ${t("hotkeys.other.selectModelTemp")} |`,
		`| \`${appKey(bindings, "app.model.select")}\` | ${t("hotkeys.other.selectModel")} |`,
		`| \`${appKey(bindings, "app.plan.toggle")}\` | ${t("hotkeys.other.togglePlan")} |`,
		`| \`${appKey(bindings, "app.history.search")}\` | ${t("hotkeys.other.searchHistory")} |`,
		`| \`${appKey(bindings, "app.tools.expand")}\` | ${t("hotkeys.other.toggleToolExpand")} |`,
		`| \`${appKey(bindings, "app.thinking.toggle")}\` | ${t("hotkeys.other.toggleThinking")} |`,
		`| \`${appKey(bindings, "app.editor.external")}\` | ${t("hotkeys.other.externalEditor")} |`,
		`| \`${appKey(bindings, "app.clipboard.pasteImage")}\` | ${t("hotkeys.other.pasteImage")} |`,
		`| \`${appKey(bindings, "app.stt.toggle")}\` | ${t("hotkeys.other.toggleStt")} |`,
		`| \`#\` | ${t("hotkeys.other.promptActions")} |`,
		`| \`/\` | ${t("hotkeys.other.slashCommands")} |`,
		`| \`!\` | ${t("hotkeys.other.runBash")} |`,
		`| \`!!\` | ${t("hotkeys.other.runBashExcluded")} |`,
		`| \`$\` | ${t("hotkeys.other.runPython")} |`,
		`| \`$$\` | ${t("hotkeys.other.runPythonExcluded")} |`,
	].join("\n");
}
