/**
 * Full-GFM markdown → HTML for assistant messages, matching Claude-for-Office
 * feature level. PURE (returns a string): `renderMarkdown(md) → html`.
 *
 * Pipeline: `md → softCloseForStreaming → marked.parse(gfm) → DOMPurify → string`.
 * `marked` PASSES RAW HTML THROUGH by design, so the XSS boundary is the
 * DOMPurify pass (see sanitize.ts), not the grammar. The custom token-object
 * renderers below add defense-in-depth (link-protocol gating, an info-string-free
 * code body, enumerated alignment classes) and the Office-parity chrome
 * (code panel, per-column table alignment) — but they are NOT the safety net;
 * sanitize.ts is.
 *
 * Browser-safe: `marked` is pure JS and DOMPurify uses the browser build.
 * `escapeHtml`/`isSafeUrl` stay exported — `isSafeUrl` is reused by the sanitizer
 * and both are unit-tested as the retained, load-bearing primitives.
 */
import { Marked, type Tokens } from "marked";
import { isCodeBlockComplete, renderCodePanel } from "./code-presentation.generated.min.js";
import { createMathExtensions } from "./math";
import { sanitizeHtml } from "./sanitize";
import { softCloseForStreaming } from "./streaming";

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function isSafeUrl(url: string): boolean {
	try {
		const u = new URL(url, "https://base.invalid");
		return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:";
	} catch {
		return false;
	}
}

const RAW_MATHML_TAG =
	/<\/?(?:annotation|maction|math|menclose|merror|mfrac|mi|mmultiscripts|mn|mo|mover|mpadded|mphantom|mprescripts|mroot|mrow|ms|mspace|msqrt|mstyle|msub|msubsup|msup|mtable|mtd|mtext|mtr|munder|munderover|none|semantics)\b/i;

/**
 * A `Marked` instance (not the global singleton, so the shared package never
 * mutates another consumer's `marked`) configured for GFM with the F5 custom
 * renderers. `mangle`/`headerIds` are gone in v17 — the defaults are correct.
 */
const marked = new Marked({ gfm: true, async: false }).use({
	extensions: createMathExtensions(),
	renderer: {
		html({ raw }: Tokens.HTML | Tokens.Tag) {
			// Source/display metadata belongs to generated panels, never author HTML.
			return RAW_MATHML_TAG.test(raw) || /\bdata-code-(?:source|display)\b/i.test(raw) ? escapeHtml(raw) : raw;
		},

		/**
		 * Link: gate the protocol through `isSafeUrl` BEFORE emitting (unsafe →
		 * link text only), then open in a new tab with safe-target rel. `this` is
		 * the marked renderer, whose `.parser` renders the inline link body.
		 */
		link({ href, title, tokens }: Tokens.Link) {
			const text = this.parser.parseInline(tokens);
			if (!isSafeUrl(href)) return text;
			const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
			return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
		},

		/**
		 * Fenced code: `token.text` is the body WITHOUT the info string (marked
		 * separates `lang`), so the old "the language leaks as the first code line"
		 * bug cannot recur. Language metadata selects syntax without visible labels.
		 */
		code(token: Tokens.Code) {
			return renderCodePanel(
				token.text,
				token.lang,
				isCodeBlockComplete(token.raw, token.codeBlockStyle === "indented"),
			);
		},

		/**
		 * Table cell: emit column alignment as an ENUMERATED class
		 * (`md-align-left|center|right`) — NOT inline `style` (DOMPurify strips it)
		 * and NOT the deprecated `align` attribute — so alignment survives
		 * sanitization and is styled under `.markdown-root`.
		 */
		tablecell(token: Tokens.TableCell) {
			const tag = token.header ? "th" : "td";
			const content = this.parser.parseInline(token.tokens);
			const alignClass = token.align ? ` class="md-align-${token.align}"` : "";
			return `<${tag}${alignClass}>${content}</${tag}>\n`;
		},
	},
});

export function renderMarkdown(md: string): string {
	const prepared = softCloseForStreaming(md, { closeCode: false });
	const html = marked.parse(prepared, { async: false });
	return sanitizeHtml(html);
}
