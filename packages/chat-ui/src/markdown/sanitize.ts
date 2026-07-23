/**
 * The single XSS choke-point for rendered markdown.
 *
 * `renderMarkdown` (render.ts) turns markdown into HTML with `marked`, which by
 * design PASSES RAW HTML THROUGH — so the untrusted surface is this DOMPurify
 * pass, not the markdown grammar. Keeping one configured sanitizer here means the
 * safety surface does NOT grow as the renderer gains features: every construct
 * (tables, task lists, code chips, links) funnels through the same allow-list.
 *
 * Browser-safe: uses the `dompurify` BROWSER build (references only
 * `window`/`document`), never `isomorphic-dompurify` (which pulls jsdom → node
 * builtins and would trip office-pane's `assertNoNodeBuiltins` gate). The
 * instance is bound LAZILY to the live global `window` on first use (present in
 * the Office WebView and in happy-dom under test) rather than at import time, so
 * an early import can never silently bind to a null window and pass HTML through
 * unsanitized.
 */
import createDOMPurify, { type Config } from "dompurify";
import { isSafeUrl } from "./render";

/**
 * The complete tag allow-list — exactly what the marked renderer emits: block
 * structure, inline emphasis, tables, GFM task-list checkboxes, and the `span`
 * used for the code-block language chip. Anything else (script, iframe, object,
 * svg, style, form, img, …) is dropped.
 */
const ALLOWED_TAGS = [
	"p",
	"br",
	"span",
	"div",
	"strong",
	"em",
	"del",
	"code",
	"pre",
	"blockquote",
	"ul",
	"ol",
	"li",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"a",
	"hr",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"input",
];

/** Only these attributes survive; `style` is deliberately absent (dropped). */
const ALLOWED_ATTR = ["href", "title", "class", "target", "rel", "type", "checked", "disabled"];

/**
 * The ENUMERATED class allow-list. Content-supplied class names cannot collide
 * with the app's chrome CSS (`.header`, `.composer`, `.menu`, …) — only these
 * cosmetic, `.markdown-root`-scoped classes are kept, and any other token on a
 * `class` attribute is stripped. This neutralizes class-based UI spoofing.
 */
const EXACT_CLASSES = new Set([
	"md-align-left",
	"md-align-center",
	"md-align-right",
	"md-lang-label",
	"task-list-item",
	"contains-task-list",
]);

/** A class token is kept iff it is an exact allow-listed name or a `language-` code hint. */
function isAllowedClass(token: string): boolean {
	return EXACT_CLASSES.has(token) || token.startsWith("language-");
}

/** DOMPurify config: tight, explicit tag/attr allow-lists, no data/aria attrs. */
const CONFIG: Config = {
	ALLOWED_TAGS,
	ALLOWED_ATTR,
	ALLOW_DATA_ATTR: false,
	ALLOW_ARIA_ATTR: false,
};

interface Purifier {
	sanitize(dirty: string, cfg?: Config): string;
	isSupported: boolean;
}

let purifier: Purifier | null = null;

/**
 * Resolve the live global `window`. In the WebView and happy-dom this is a real
 * DOM window; we bind to it lazily (see file header) so sanitization is never a
 * silent no-op against a null window.
 */
function getWindow(): typeof globalThis | undefined {
	const w = (globalThis as { window?: typeof globalThis }).window;
	return w ?? undefined;
}

/** Build the configured, hook-installed DOMPurify instance bound to `window`. */
function build(): Purifier {
	const win = getWindow();
	if (!win) {
		throw new Error("markdown sanitize: no DOM window available to bind DOMPurify — cannot sanitize safely");
	}
	// `createDOMPurify(window)` returns an instance bound to that window.
	const dp = createDOMPurify(win as unknown as Window & typeof globalThis);
	if (!dp.isSupported) {
		throw new Error("markdown sanitize: DOMPurify reports the environment is unsupported — refusing to render");
	}

	// Hook 1 — filter `class` to the enumerated allow-list (drop UI-spoofing tokens).
	dp.addHook("uponSanitizeAttribute", (_node, data) => {
		if (data.attrName !== "class") return;
		const kept = data.attrValue.split(/\s+/).filter(t => t.length > 0 && isAllowedClass(t));
		if (kept.length === 0) {
			data.keepAttr = false;
			return;
		}
		data.attrValue = kept.join(" ");
	});

	// Hook 2 — anchors: drop unsafe protocols (defense-in-depth over DOMPurify's
	// own URI gate) and force safe-target semantics on every surviving link.
	dp.addHook("afterSanitizeAttributes", node => {
		if (node.nodeName !== "A") return;
		const el = node as Element;
		const href = el.getAttribute("href");
		if (href !== null && !isSafeUrl(href)) {
			el.removeAttribute("href");
			return;
		}
		if (href !== null) {
			el.setAttribute("target", "_blank");
			el.setAttribute("rel", "noopener noreferrer");
		}
	});

	// Hook 3 — inputs: keep ONLY a disabled checkbox (the GFM task-list marker);
	// drop every other input entirely so no interactive control can be injected.
	dp.addHook("uponSanitizeElement", (node, data) => {
		if (data.tagName !== "input") return;
		const el = node as Element;
		if (el.getAttribute("type") !== "checkbox") {
			el.remove();
			return;
		}
		el.setAttribute("disabled", "");
	});

	return dp as unknown as Purifier;
}

/** Sanitize renderer HTML through the configured DOMPurify choke-point. */
export function sanitizeHtml(html: string): string {
	if (!purifier) purifier = build();
	return purifier.sanitize(html, CONFIG);
}
