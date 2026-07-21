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
import {
	forwardRef,
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { type Attachment, serializeAttachments } from "../attachments/model";
import type { AttachCategory, InteractionMode, ModelOption, SlashCommand, ToolItem } from "../types";
import { AttachMenu } from "./AttachMenu";
import { PlusIcon, SendIcon, StopIcon } from "./icons";
import { ModelSelector } from "./ModelSelector";
import { ModeToggle } from "./ModeToggle";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { StatusBar } from "./StatusBar";
import { ToolsPickerMenu } from "./ToolsPickerMenu";

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
	/** Simple attach affordance — a bare "+" button (rendered only when provided,
	 *  and only when the richer `attachCategories` picker is NOT in use). */
	onAttach?: () => void;
	/**
	 * Attachment picker. When `attachCategories` is provided the "+" button opens
	 * a category menu; picking one fires `onRequestAttachment(categoryId)` and the
	 * HOST sources the attachment and feeds it back through the controlled
	 * `attachments` array. `onRemoveAttachment` drops a chip. On submit the
	 * attachments serialize to a labelled prefix prepended to the message; the host
	 * clears its `attachments` state in its `onSend` handler.
	 */
	attachments?: Attachment[];
	attachCategories?: AttachCategory[];
	onRequestAttachment?: (categoryId: string) => void;
	onRemoveAttachment?: (id: string) => void;
	/**
	 * Multi-select tools picker (VS Code parity). When `tools` + `onToolsConfirm`
	 * are provided AND `attachCategories` includes an id `"tools"`, picking that
	 * category opens a multi-select popup instead of round-tripping via
	 * `onRequestAttachment`; confirming fires `onToolsConfirm(names)` so the host
	 * builds the tools attachment and feeds it back through `attachments`.
	 */
	tools?: ToolItem[];
	onToolsConfirm?: (names: string[]) => void;
	/** Slash-command menu — a "/" button (rendered only when both are provided). */
	slashCommands?: SlashCommand[];
	onSlashSelect?: (command: string) => void;
	/** Thinking-level control shown inside the mode menu (VS Code parity). */
	thinkingLevels?: string[];
	thinkingLevel?: string;
	onThinkingChange?: (level: string) => void;
	/** Status bar signals (embedded on the top border). */
	contextPct?: number | null;
	sessionLabel?: string;
}

/** True while an IME composition is active, so Enter confirms a candidate
 * (CJK etc.) instead of sending a half-typed message. Handles both the React
 * synthetic event (`nativeEvent`) and the raw event preact/compat passes. The
 * explicit element generic keeps it valid under both React's `KeyboardEvent<T>`
 * and preact/compat's `TargetedKeyboardEvent<T>` (which requires the argument). */
function isImeComposing(e: ReactKeyboardEvent<HTMLElement>): boolean {
	// `nativeEvent` exists on the React synthetic event but NOT on preact/compat's
	// event type — access it through an optional cast so this compiles under both:
	// React reads the wrapped DOM event; preact falls back to the (already-raw) event.
	const native = (e as unknown as { nativeEvent?: KeyboardEvent }).nativeEvent ?? (e as unknown as KeyboardEvent);
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
		attachments,
		attachCategories,
		onRequestAttachment,
		onRemoveAttachment,
		tools,
		onToolsConfirm,
		slashCommands,
		onSlashSelect,
		thinkingLevels,
		thinkingLevel,
		onThinkingChange,
		contextPct = null,
		sessionLabel = "",
	},
	ref,
) {
	const editorRef = useRef<HTMLDivElement>(null);
	const [text, setText] = useState("");
	const [showToolsPicker, setShowToolsPicker] = useState(false);
	const hasAttachments = (attachments?.length ?? 0) > 0;
	const canPickTools = tools != null && onToolsConfirm != null;

	// AttachMenu category pick: the "tools" category opens the multi-select picker
	// (when tools are provided); every other category round-trips to the host.
	const handleCategory = useCallback(
		(id: string) => {
			if (id === "tools" && canPickTools) {
				setShowToolsPicker(true);
				return;
			}
			onRequestAttachment?.(id);
		},
		[canPickTools, onRequestAttachment],
	);

	const submit = useCallback(() => {
		const el = editorRef.current;
		const value = (el?.textContent ?? text).trim();
		if ((!value && !hasAttachments) || disabled) return;
		// Prepend the labelled attachment prefix; the host clears its `attachments`
		// state on send. Attachments-only (no text) sends just the prefix.
		const prefix = attachments && attachments.length > 0 ? serializeAttachments(attachments) : "";
		const finalText = [prefix, value].filter(Boolean).join("\n\n");
		onSend(finalText);
		if (el) el.textContent = "";
		setText("");
	}, [text, disabled, onSend, attachments, hasAttachments]);

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

	const canSend = (text.trim().length > 0 || hasAttachments) && !disabled;

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
					onInput={handleInput}
					onKeyDown={e => {
						if (e.key === "Enter" && !e.shiftKey && !isImeComposing(e)) {
							e.preventDefault();
							submit();
						}
					}}
				/>
			</div>
			{attachments && attachments.length > 0 && (
				<div className="attachment-chips">
					{attachments.map(a => (
						<div key={a.id} className="attachment-chip">
							<span className="attachment-chip-kind">{a.kind}</span>
							<span className="attachment-chip-label">{a.label}</span>
							{onRemoveAttachment && (
								<button
									type="button"
									className="attachment-chip-remove"
									title="Remove"
									aria-label={`Remove ${a.label}`}
									onClick={() => onRemoveAttachment(a.id)}
								>
									×
								</button>
							)}
						</div>
					))}
				</div>
			)}
			<div className="input-footer">
				<div className="attach-area" style={{ position: "relative" }}>
					{showToolsPicker && tools && onToolsConfirm && (
						<div style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: 4, zIndex: 10 }}>
							<ToolsPickerMenu
								tools={tools}
								onConfirm={onToolsConfirm}
								onClose={() => setShowToolsPicker(false)}
							/>
						</div>
					)}
					{attachCategories ? (
						<AttachMenu categories={attachCategories} onSelect={handleCategory} disabled={disabled} />
					) : onAttach ? (
						<button type="button" className="footer-btn" title="Attach" aria-label="Attach" onClick={onAttach}>
							<PlusIcon />
						</button>
					) : null}
				</div>
				{slashCommands && onSlashSelect && (
					<SlashCommandMenu commands={slashCommands} onSelect={onSlashSelect} disabled={disabled} />
				)}
				{modes && mode != null && onModeChange && (
					<ModeToggle
						modes={modes}
						mode={mode}
						onChange={onModeChange}
						thinkingLevels={thinkingLevels}
						thinkingLevel={thinkingLevel}
						onThinkingChange={onThinkingChange}
					/>
				)}
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
