/**
 * The gutter-grid message renderers, promoted from the Chrome side-panel and
 * authored in the React idiom. Each row is a 2-column grid: a terminal glyph
 * gutter + the message body (see `.row`/`.gutter` in panel.css.ts).
 */
import type { ReactNode } from "react";
import { GLYPHS } from "../theme/tokens";
import { MarkdownRenderer } from "./MarkdownRenderer";

export function GutterRow({
	glyph,
	glyphClass,
	children,
}: {
	glyph: string;
	glyphClass?: string;
	children: ReactNode;
}) {
	return (
		<div className="row">
			<div className={`gutter ${glyphClass ?? ""}`}>{glyph}</div>
			<div className="content">{children}</div>
		</div>
	);
}

export function AssistantMessage({ text }: { text: string }) {
	// renderMarkdown output is trusted (escaped + tiny allow-list); user text never reaches here.
	return (
		<GutterRow glyph={GLYPHS.assistant} glyphClass="g-assistant">
			<MarkdownRenderer text={text} />
		</GutterRow>
	);
}

export function UserMessage({ text }: { text: string }) {
	return (
		<div className="msg-user">
			<GutterRow glyph={GLYPHS.userGutter} glyphClass="g-user">
				<div className="body user-body">{text}</div>
			</GutterRow>
		</div>
	);
}

export function ToolMessage({ tool, ok, text }: { tool: string; ok: boolean; text: string }) {
	return (
		<GutterRow glyph={GLYPHS.assistant} glyphClass={ok ? "g-tool-ok" : "g-tool-err"}>
			<div className="body tool-body">{`${tool}: ${ok ? "✓" : "✗"} ${text}`}</div>
		</GutterRow>
	);
}

export function ThinkingIndicator({ level }: { level?: number }) {
	const lvl = level != null ? GLYPHS.thinkingLevels[Math.min(level, GLYPHS.thinkingLevels.length - 1)] : null;
	return (
		<GutterRow glyph={GLYPHS.thinking} glyphClass="g-thinking spin">
			<div className="body thinking">Thinking…{lvl ? ` ${lvl}` : ""}</div>
		</GutterRow>
	);
}

export function ErrorMessage({ text, onRetry }: { text: string; onRetry?: () => void }) {
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
