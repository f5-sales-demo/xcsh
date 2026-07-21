/**
 * The unified composer: a rounded, red-bordered box (Chrome's frame) holding a
 * `contenteditable` editor (VS Code's InputBar idiom) on top and a footer
 * toolbar below. The powerline {@link StatusBar} is embedded on the box's top
 * border. Footer layout mirrors Claude for Office structurally:
 *   LEFT  → attach menu + {@link ModeToggle}
 *   RIGHT → {@link ModelSelector} + send/stop
 * Send is disabled while the editor is empty and swaps to a stop button while a
 * turn is streaming. Every data source + callback is a prop — headless.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { InteractionMode, ModelOption } from "../types";
import { PlusIcon, SendIcon, StopIcon } from "./icons";
import { ModelSelector } from "./ModelSelector";
import { ModeToggle } from "./ModeToggle";
import { StatusBar } from "./StatusBar";

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

export function Composer({
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
}: ComposerProps) {
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
						if (e.key === "Enter" && !e.shiftKey) {
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
}
