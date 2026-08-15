/**
 * The gutter-grid message renderers, promoted from the Chrome side-panel and
 * authored in the React idiom. Each row is a 2-column grid: a terminal glyph
 * gutter + the message body (see `.row`/`.gutter` in panel.css.ts).
 */
import { type ReactNode, useEffect, useState } from "react";
import { GLYPHS } from "../theme/tokens";
import { toolActivityLabel } from "../tools/activity-label";
import type { ChatMediaContent, ChatMediaFrame, ChatReference } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ReferenceChips } from "./ReferenceChips";

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
	/** Cited sources, rendered as a "Sources" chip row beneath the answer. */
	references?: ChatReference[];
	media?: ChatMediaContent[];
	/** This is the live turn: render a blinking caret after the text (live-typing cue). */
	streaming?: boolean;
}

export function AssistantMessage({ text, references, media, streaming }: AssistantMessageProps) {
	// renderMarkdown output is DOMPurify-sanitized (see markdown/sanitize.ts). The
	// `markdown-root` class opts the assistant body into the block stylesheet
	// (tables, headings, lists, code) — matching ContentBlockRenderer's text path.
	return (
		<GutterRow glyph={GLYPHS.assistant} glyphClass="g-assistant">
			<MarkdownRenderer className="body markdown-root" text={text} />
			{media?.map(item => (
				<RichMedia key={item.id} media={item} />
			))}
			{streaming ? <span className="stream-caret" aria-hidden="true" /> : null}
			{references && references.length > 0 ? <ReferenceChips references={references} /> : null}
		</GutterRow>
	);
}

function prefersReducedMotion(): boolean {
	return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function Timeline({ frames, loop, autoplay }: { frames: ChatMediaFrame[]; loop: boolean; autoplay: boolean }) {
	const reduced = prefersReducedMotion();
	const [index, setIndex] = useState(0);
	useEffect(() => {
		if (reduced || !autoplay || frames.length < 2) return;
		const frame = frames[index];
		if (!frame) return;
		if (!loop && index === frames.length - 1) return;
		const timer = window.setTimeout(() => setIndex(current => (current + 1) % frames.length), frame.durationMs);
		return () => window.clearTimeout(timer);
	}, [autoplay, frames, index, loop, reduced]);
	const frame = frames[index] ?? frames[0];
	if (!frame) return null;
	return frame.src ? (
		<img className="chat-media-asset" src={frame.src} alt="" />
	) : (
		<pre className="chat-media-text">{frame.text}</pre>
	);
}

function RichMedia({ media }: { media: ChatMediaContent }) {
	const reduced = prefersReducedMotion();
	let body: ReactNode;
	if ((media.kind === "raster-timeline" || media.kind === "text-timeline") && media.frames) {
		body = <Timeline frames={media.frames} loop={media.playback.loop} autoplay={media.playback.autoplay} />;
	} else if (media.kind === "video" && media.src) {
		body = (
			<video
				className="chat-media-asset"
				src={media.src}
				poster={media.posterSrc}
				muted
				controls
				loop={media.playback.loop}
				autoPlay={!reduced && media.playback.autoplay}
				playsInline
			/>
		);
	} else if (media.src || media.posterSrc) {
		body = <img className="chat-media-asset" src={media.src ?? media.posterSrc} alt={media.alt ?? ""} />;
	} else {
		body = <div className="chat-media-degradation">Media asset unavailable.</div>;
	}
	return (
		<figure className="chat-media">
			{body}
			{media.caption ? <figcaption>{media.caption}</figcaption> : null}
			{media.degradation ? <div className="chat-media-degradation">{media.degradation}</div> : null}
		</figure>
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
	/** The call is still in flight — render a live spinner instead of a settled glyph. */
	running?: boolean;
}

/**
 * A compact tool-activity row (parity with Claude for Office's "Read data ›"):
 * a humanized label + a status affordance. Raw payload text, when present, is
 * tucked behind a native `<details>` disclosure so the transcript stays scannable;
 * activity rows with no payload (the Office host-tool lifecycle, which the pane
 * observes call-side only) render a plain line.
 */
export function ToolMessage({ tool, ok, text, running }: ToolMessageProps) {
	const label = toolActivityLabel(tool);
	const glyphClass = running ? "g-tool-run spin" : ok ? "g-tool-ok" : "g-tool-err";
	const status = <span className="tool-activity-status">{running ? "…" : ok ? "✓" : "✗"}</span>;

	return (
		<GutterRow glyph={GLYPHS.assistant} glyphClass={glyphClass}>
			{text ? (
				<details className="tool-activity">
					<summary className="tool-activity-summary">
						<span className="tool-activity-label">{label}</span>
						{status}
					</summary>
					<pre className="tool-activity-detail">{text}</pre>
				</details>
			) : (
				<div className="body tool-activity-line">
					<span className="tool-activity-label">{label}</span>
					{status}
				</div>
			)}
		</GutterRow>
	);
}

export interface ThinkingIndicatorProps {
	/** Thinking-depth glyph index (visual intensity), NOT a text label. */
	level?: number;
	/**
	 * Short suffix explaining why this turn will take longer, e.g. "with web search".
	 * A server-side search costs several seconds before the first token, and a bare
	 * "Thinking…" through that window reads as a hang.
	 */
	label?: string;
}

export function ThinkingIndicator({ level, label }: ThinkingIndicatorProps) {
	const lvl = level != null ? GLYPHS.thinkingLevels[Math.min(level, GLYPHS.thinkingLevels.length - 1)] : null;
	return (
		<GutterRow glyph={GLYPHS.thinking} glyphClass="g-thinking spin">
			<div className="body thinking">
				Thinking…{lvl ? ` ${lvl}` : ""}
				{label ? ` ${label}` : ""}
			</div>
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
