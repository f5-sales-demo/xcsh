/**
 * Multi-line editor component for hooks and ask custom input.
 * Supports Ctrl+G for external editor.
 *
 * Two modes:
 * - Default (hook): Enter inserts newline, Ctrl+Enter submits
 * - Prompt-style (ask): Enter submits, Shift+Enter inserts newline
 * Both modes use the shared frame and scrollable editor viewport.
 */
import { Container, Editor, getKeybindings, matchesKey, type TUI, wrapTextWithAnsi } from "@f5-sales-demo/pi-tui";
import { formatKeyHints } from "../../config/keybindings";
import { getEditorTheme } from "../../modes/theme/theme";
import { matchesAppExternalEditor, matchesSelectCancel } from "../../modes/utils/keybinding-matchers";
import { getEditorCommand, openInEditor } from "../../utils/external-editor";
import { matchesSelectorKey, selectorCancelHint, selectorFrame, selectorFrameContentWidth } from "./selector-frame";

export interface HookEditorOptions {
	/** When true, plain Enter submits and modified Enter inserts a newline. */
	promptStyle?: boolean;
}

export class HookEditorComponent extends Container {
	#editor: Editor;
	#onSubmitCallback: (value: string) => void;
	#onCancelCallback: () => void;
	#tui: TUI;
	#promptStyle: boolean;
	#closed = false;
	#external = false;
	#error = "";
	#detailsActive = false;
	#offset = 0;
	#detailLength = 0;
	#capacity = 1;

	constructor(
		tui: TUI,
		private readonly title: string,
		prefill: string | undefined,
		onSubmit: (value: string) => void,
		onCancel: () => void,
		options?: HookEditorOptions,
	) {
		super();

		this.#tui = tui;
		this.#onSubmitCallback = onSubmit;
		this.#onCancelCallback = onCancel;
		this.#promptStyle = options?.promptStyle ?? false;

		// Editor
		this.#editor = new Editor(getEditorTheme());
		this.#editor.setBorderVisible(false);
		this.#editor.setPromptGutter("> ");
		if (this.#promptStyle) {
			this.#editor.disableSubmit = true;
		}
		if (prefill) {
			this.#editor.setText(prefill);
		}
	}
	override render(width: number): string[] {
		const rows = this.#tui.terminal.rows || process.stdout.rows || 24;
		const inner = selectorFrameContentWidth(width);
		const description = wrapTextWithAnsi(this.title, inner);
		const details = wrapTextWithAnsi(
			[this.#error, ...(description.length > 2 ? [this.title] : [])].filter(Boolean).join("\n"),
			inner,
		);
		this.#detailLength = details.length;
		this.#capacity = Math.max(1, Math.min(4, rows - 14));
		this.#offset = Math.min(this.#offset, Math.max(0, details.length - this.#capacity));
		this.#editor.setMaxHeight(Math.max(1, rows - 11 - Math.min(this.#capacity, details.length)));
		const bindings = getKeybindings();
		const externalKeys = bindings.getDefinition("app.editor.external")
			? bindings.getKeys("app.editor.external")
			: ["ctrl+g" as const];
		return selectorFrame(
			width,
			rows,
			"Extension editor",
			this.title,
			[],
			this.#editor.render(inner),
			details.slice(this.#offset, this.#offset + this.#capacity),
			[
				this.#promptStyle ? "Shift+Enter: newline" : "Ctrl+Enter: submit",
				...(externalKeys.length ? [`${formatKeyHints(externalKeys)}: external editor`] : []),
				selectorCancelHint(this.#detailsActive ? "return to editor" : "cancel"),
				...(details.length > this.#capacity
					? [this.#detailsActive ? "PgUp/PgDn: details · Tab: editor" : "Tab: question details"]
					: []),
			],
		);
	}

	handleInput(keyData: string): void {
		if (this.#closed || this.#external) return;
		if (matchesKey(keyData, "tab") && this.#detailLength > this.#capacity) {
			this.#detailsActive = !this.#detailsActive;
			return;
		}
		if (this.#detailsActive) {
			if (matchesSelectorKey(keyData, "cancel")) this.#detailsActive = false;
			else if (matchesSelectorKey(keyData, "pageDown"))
				this.#offset = Math.min(Math.max(0, this.#detailLength - this.#capacity), this.#offset + this.#capacity);
			else if (matchesSelectorKey(keyData, "pageUp")) this.#offset = Math.max(0, this.#offset - this.#capacity);
			return;
		}
		if (this.#promptStyle) {
			this.#handlePromptStyleInput(keyData);
		} else {
			this.#handleHookStyleInput(keyData);
		}
	}

	/** Prompt-style: raw Enter submits; Editor owns newline-producing sequences. */
	#handlePromptStyleInput(keyData: string): void {
		// Closing an input view is navigation, independent of execution interruption.
		if (matchesSelectCancel(keyData)) {
			this.#closed = true;
			this.#onCancelCallback();
			return;
		}

		// Ctrl+G for external editor
		if (matchesAppExternalEditor(keyData)) {
			void this.#openExternalEditor();
			return;
		}

		// Submit on any plain Enter encoding, including terminals that report unmodified Enter as LF.
		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return")) {
			this.#closed = true;
			this.#onSubmitCallback(this.#editor.getText());
			return;
		}

		// Let Editor handle modified newline-producing variants (Shift+Enter, Ctrl+Enter, Alt+Enter, etc.)
		this.#editor.handleInput(keyData);
	}

	/** Hook-style: Enter=newline, Ctrl+Enter=submit (original behavior) */
	#handleHookStyleInput(keyData: string): void {
		// Ctrl+Enter to submit
		if (keyData === "\x1b[13;5u" || keyData === "\x1b[27;5;13~") {
			this.#closed = true;
			this.#onSubmitCallback(this.#editor.getText());
			return;
		}

		// Plain Enter inserts a new line in hook editor
		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			this.#editor.handleInput("\n");
			return;
		}

		// Escape to cancel
		if (matchesSelectCancel(keyData)) {
			this.#closed = true;
			this.#onCancelCallback();
			return;
		}

		// Ctrl+G for external editor
		if (matchesAppExternalEditor(keyData)) {
			void this.#openExternalEditor();
			return;
		}

		// Forward to editor
		this.#editor.handleInput(keyData);
	}

	async #openExternalEditor(): Promise<void> {
		const editorCmd = getEditorCommand();
		if (!editorCmd) {
			this.#error = "No external editor configured. Set VISUAL or EDITOR, or keep editing here.";
			return;
		}
		this.#external = true;

		const currentText = this.#editor.getText();
		try {
			this.#tui.stop();
			const result = await openInEditor(editorCmd, currentText);
			if (result !== null) {
				this.#editor.setText(result);
			}
			this.#error = "";
		} catch (error) {
			this.#error = `External editor failed: ${error instanceof Error ? error.message : String(error)}. Draft retained.`;
		} finally {
			this.#external = false;
			this.#tui.start();
			this.#tui.requestRender(true);
		}
	}
}
