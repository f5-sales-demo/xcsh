/**
 * React wrapper over the pure `renderMarkdown` (full GFM → marked → DOMPurify).
 * The HTML is sanitized by construction — DOMPurify with the airtight F5 config
 * (see markdown/sanitize.ts) is the security boundary — so
 * `dangerouslySetInnerHTML` is sound here.
 *
 * The sink is a block-level `<div>`: `renderMarkdown` emits block elements
 * (`<table>`/`<h1>`/`<ul>`/`<pre>`/`<blockquote>`/`<hr>`) which are invalid
 * inside an inline `<span>` and would be reparented by the browser, breaking the
 * `.markdown-root` block CSS.
 *
 * Streaming: assistant text arrives one `chat_delta` at a time and this component
 * re-renders per delta. `renderMarkdown` is synchronous, so to avoid O(n²) reparse
 * jank on a long, actively-streaming message we coalesce re-parses to an animation
 * frame while `streaming` is true, and parse synchronously once it settles (so the
 * final frame is never dropped).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "../markdown/render";

export interface MarkdownRendererProps {
	text: string;
	className?: string;
	/**
	 * When true, coalesce re-renders to an animation frame (the message is still
	 * streaming). Defaults to false → parse synchronously every render.
	 */
	streaming?: boolean;
}

/** rAF with a synchronous fallback for non-DOM/SSR/test realms without rAF. */
function scheduleFrame(cb: () => void): () => void {
	const raf = (globalThis as { requestAnimationFrame?: (cb: FrameRequestCallback) => number }).requestAnimationFrame;
	if (typeof raf === "function") {
		const id = raf(() => cb());
		const cancelFrame = (globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame;
		return () => cancelFrame?.(id);
	}
	cb();
	return () => {};
}

export function MarkdownRenderer({ text, className, streaming = false }: MarkdownRendererProps) {
	// Synchronous parse — used for the non-streaming path and as the settled value.
	const settledHtml = useMemo(() => renderMarkdown(text), [text]);

	// While streaming, hold the last painted HTML and only swap it in on a frame
	// so a burst of deltas coalesces into one reparse per frame (not per delta).
	const [frameHtml, setFrameHtml] = useState(settledHtml);
	const latestText = useRef(text);
	latestText.current = text;

	useEffect(() => {
		if (!streaming) {
			setFrameHtml(settledHtml);
			return;
		}
		return scheduleFrame(() => setFrameHtml(renderMarkdown(latestText.current)));
	}, [streaming, settledHtml]);

	const html = streaming ? frameHtml : settledHtml;

	return (
		// biome-ignore lint/security/noDangerouslySetInnerHtml: output is DOMPurify-sanitized (see markdown/sanitize.ts)
		<div className={className ?? "body"} dangerouslySetInnerHTML={{ __html: html }} />
	);
}
