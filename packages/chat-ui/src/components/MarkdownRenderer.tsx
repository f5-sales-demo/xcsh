/**
 * React wrapper over the pure `renderMarkdown` (escaped allow-list, XSS-safe).
 * The HTML is trusted by construction — everything is escaped, then a tiny
 * allow-list is re-introduced — so `dangerouslySetInnerHTML` is sound here.
 */
import { useMemo } from "react";
import { renderMarkdown } from "../markdown/render";

export interface MarkdownRendererProps {
	text: string;
	className?: string;
}

export function MarkdownRenderer({ text, className }: MarkdownRendererProps) {
	const html = useMemo(() => renderMarkdown(text), [text]);
	return (
		// biome-ignore lint/security/noDangerouslySetInnerHtml: output is escaped + tiny allow-list (see markdown/render.ts)
		<span className={className ?? "body"} dangerouslySetInnerHTML={{ __html: html }} />
	);
}
