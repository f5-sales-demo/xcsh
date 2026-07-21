/**
 * The gutter-grid message renderers, promoted from the Chrome side-panel and
 * authored in the React idiom. Each row is a 2-column grid: a terminal glyph
 * gutter + the message body (see `.row`/`.gutter` in panel.css.ts).
 */
import type { ReactNode } from "react";
import { GLYPHS } from "../theme/tokens";
import { MarkdownRenderer } from "./MarkdownRenderer";

export interface GutterRowProps {
	glyph: string;
	glyphClass?: string;
	children: ReactNode;
}

export function GutterRow({ glyph, glyphClass, children }: GutterRowProps) {
	return (
		<div className="row">
			<div className={`gutter ${glyphClass ?? ""}`}>{glyph}</div>
			<div className="content">{children}</div>
		</div>
	);
}

export interface AssistantMessageProps {
	text: string;
}

export function AssistantMessage({ text }: AssistantMessageProps) {
	// renderMarkdown output is trusted (escaped + tiny allow-list); user text never reaches here.
	return (
		<GutterRow glyph={GLYPHS.assistant} glyphClass="g-assistant">
			<MarkdownRenderer text={text} />
		</GutterRow>
	);
}

export interface UserMessageProps {
	text: string;
}

export function UserMessage({ text }: UserMessageProps) {
	return (
		<div className="msg-user">
			<GutterRow glyph={GLYPHS.userGutter} glyphClass="g-user">
				<div className="body user-body">{text}</div>
			</GutterRow>
		</div>
	);
}

export interface ToolMessageProps {
	tool: string;
	ok: boolean;
	text: string;
}

export function ToolMessage({ tool, ok, text }: ToolMessageProps) {
	return (
		<GutterRow glyph={GLYPHS.assistant} glyphClass={ok ? "g-tool-ok" : "g-tool-err"}>
			<div className="body tool-body">{`${tool}: ${ok ? "✓" : "✗"} ${text}`}</div>
		</GutterRow>
	);
}

export interface ThinkingIndicatorProps {
	level?: number;
}

export function ThinkingIndicator({ level }: ThinkingIndicatorProps) {
	const lvl = level != null ? GLYPHS.thinkingLevels[Math.min(level, GLYPHS.thinkingLevels.length - 1)] : null;
	return (
		<GutterRow glyph={GLYPHS.thinking} glyphClass="g-thinking spin">
			<div className="body thinking">Thinking…{lvl ? ` ${lvl}` : ""}</div>
		</GutterRow>
	);
}

export interface ErrorMessageProps {
	text: string;
	onRetry?: () => void;
}

export function ErrorMessage({ text, onRetry }: ErrorMessageProps) {
	return (
		<GutterRow glyph={GLYPHS.system} glyphClass="g-error">
			<div className="body error">
				{text}
				{onRetry ? (
					<button type="button" className="msg-retry" onClick={onRetry}>
						Retry
					</button>
				) : null}
			</div>
		</GutterRow>
	);
}
