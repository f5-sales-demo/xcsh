/**
 * The unified composer: a rounded, red-bordered box (Chrome's frame) holding a
 * `contenteditable` editor (VS Code's InputBar idiom) on top and a footer
 * toolbar below. The powerline {@link StatusBar} is embedded on the box's top
 * border. Footer layout mirrors Claude for Office structurally:
 *   LEFT  → attach menu + {@link ModeToggle}
 *   RIGHT → {@link ModelSelector} + send/stop
 * Send is disabled while the editor is empty and swaps to a stop button while a
 * turn is streaming. Every data source + callback is a prop — headless.
 *
 * The editor is uncontrolled (contenteditable); hosts push text into it (e.g. a
 * clicked skill pill or slash-command that should POPULATE the input for editing
 * rather than send immediately) via an imperative {@link ComposerHandle} ref:
 * `ref.current.setText(text)` / `ref.current.focus()`. This avoids
 * controlled-contenteditable churn and is framework-neutral under preact/compat.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { InteractionMode, ModelOption } from "../types";
import { PlusIcon, SendIcon, StopIcon } from "./icons";
import { ModelSelector } from "./ModelSelector";
import { ModeToggle } from "./ModeToggle";
import { StatusBar } from "./StatusBar";

/** Imperative handle a host uses to prefill / focus the uncontrolled editor. */
export interface ComposerHandle {
	/** Replace the editor contents (does NOT send) and focus, caret at end. */
	setText: (text: string) => void;
	focus: () => void;
}

export interface ComposerProps {
	placeholder?: string;
	streaming: boolean;
	/** Disables the editor + send (e.g. while the bridge is offline). */
	disabled?: boolean;
	onSend: (text: string) => void;
	onStop: () => void;
	/** Conversation-mode toggle (rendered only when all three are provided). */
	modes?: InteractionMode[];
	mode?: string;
	onModeChange?: (id: string) => void;
	/** Model selector (rendered only when all three are provided). */
	models?: ModelOption[];
	model?: string;
	onModelChange?: (id: string) => void;
	/** Attach affordance (rendered only when provided). */
	onAttach?: () => void;
	/** Status bar signals (embedded on the top border). */
	contextPct?: number | null;
	sessionLabel?: string;
}

/** True while an IME composition is active, so Enter confirms a candidate
 * (CJK etc.) instead of sending a half-typed message. Handles both the React
 * synthetic event (`nativeEvent`) and the raw event preact/compat passes. */
function isImeComposing(e: React.KeyboardEvent): boolean {
	const native = e.nativeEvent ?? (e as unknown as KeyboardEvent);
	return Boolean(native?.isComposing) || (e as unknown as { keyCode?: number }).keyCode === 229;
}

function placeCaretAtEnd(el: HTMLElement): void {
	if (typeof window === "undefined" || !window.getSelection) return;
	const sel = window.getSelection();
	if (!sel || !el.ownerDocument) return;
	const range = el.ownerDocument.createRange();
	range.selectNodeContents(el);
	range.collapse(false);
	sel.removeAllRanges();
	sel.addRange(range);
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
	{
		placeholder = "ask xcsh…",
		streaming,
		disabled = false,
		onSend,
		onStop,
		modes,
		mode,
		onModeChange,
		models,
		model,
		onModelChange,
		onAttach,
		contextPct = null,
		sessionLabel = "",
	},
	ref,
) {
	const editorRef = useRef<HTMLDivElement>(null);
	const [text, setText] = useState("");

	const submit = useCallback(() => {
		const el = editorRef.current;
		const value = (el?.textContent ?? text).trim();
		if (!value || disabled) return;
		onSend(value);
		if (el) el.textContent = "";
		setText("");
	}, [text, disabled, onSend]);

	const handleInput = useCallback(() => {
		setText(editorRef.current?.textContent ?? "");
	}, []);

	useImperativeHandle(
		ref,
		() => ({
			setText(value: string) {
				const el = editorRef.current;
				if (el) {
					el.textContent = value;
					el.focus();
					placeCaretAtEnd(el);
				}
				setText(value);
			},
			focus() {
				editorRef.current?.focus();
			},
		}),
		[],
	);

	// Focus the editor when a turn ends (matches the VS Code InputBar).
	useEffect(() => {
		if (!streaming && !disabled) editorRef.current?.focus();
	}, [streaming, disabled]);

	const canSend = text.trim().length > 0 && !disabled;

	return (
		<form
			className="composer"
			onSubmit={e => {
				e.preventDefault();
				submit();
			}}
		>
			<StatusBar contextPct={contextPct} sessionLabel={sessionLabel} />
			<div className="input-editor-container">
				{/* biome-ignore lint/a11y/useSemanticElements: contentEditable requires a div; role+tabIndex provide equivalent semantics */}
				<div
					ref={editorRef}
					className="input"
					contentEditable={!disabled}
					role="textbox"
					aria-label="Message input"
					aria-multiline="true"
					tabIndex={0}
					data-placeholder={placeholder}
					suppressContentEditableWarning
					onInput={handleInput}
					onKeyDown={e => {
						if (e.key === "Enter" && !e.shiftKey && !isImeComposing(e)) {
							e.preventDefault();
							submit();
						}
					}}
				/>
			</div>
			<div className="input-footer">
				{onAttach && (
					<button type="button" className="footer-btn" title="Attach" aria-label="Attach" onClick={onAttach}>
						<PlusIcon />
					</button>
				)}
				{modes && mode != null && onModeChange && <ModeToggle modes={modes} mode={mode} onChange={onModeChange} />}
				<div className="footer-spacer" />
				{models && model != null && onModelChange && (
					<ModelSelector models={models} model={model} onSelect={onModelChange} disabled={disabled} />
				)}
				{streaming ? (
					<button type="button" className="footer-btn send-btn" title="Stop" aria-label="Stop" onClick={onStop}>
						<StopIcon />
					</button>
				) : (
					<button type="submit" className="footer-btn send-btn" title="Send" aria-label="Send" disabled={!canSend}>
						<SendIcon />
					</button>
				)}
			</div>
		</form>
	);
});
