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
	"math",
	"maction",
	"menclose",
	"merror",
	"mfrac",
	"mi",
	"mmultiscripts",
	"mn",
	"mo",
	"mover",
	"mpadded",
	"mphantom",
	"mprescripts",
	"mroot",
	"mrow",
	"ms",
	"mspace",
	"msqrt",
	"mstyle",
	"msub",
	"msubsup",
	"msup",
	"mtable",
	"mtd",
	"mtext",
	"mtr",
	"munder",
	"munderover",
	"none",
	"annotation",
	"annotation-xml",
	"semantics",
];

/** Only these attributes survive; style is restricted to generated MathML below. */
const ALLOWED_ATTR = [
	"href",
	"title",
	"class",
	"target",
	"rel",
	"type",
	"checked",
	"disabled",
	"style",
	"display",
	"accent",
	"accentunder",
	"align",
	"bevelled",
	"columnalign",
	"columnlines",
	"columnspacing",
	"columnspan",
	"denomalign",
	"depth",
	"displaystyle",
	"encoding",
	"fence",
	"form",
	"frame",
	"framespacing",
	"height",
	"largeop",
	"linethickness",
	"lspace",
	"mathbackground",
	"mathcolor",
	"mathvariant",
	"maxsize",
	"minlabelspacing",
	"minsize",
	"movablelimits",
	"notation",
	"numalign",
	"rowalign",
	"rowlines",
	"rowspacing",
	"rowspan",
	"rspace",
	"scriptlevel",
	"separator",
	"side",
	"stretchy",
	"symmetric",
	"width",
];
const HTML_ATTRIBUTES = new Set(["href", "title", "class", "target", "rel", "type", "checked", "disabled"]);
const MATHML_ATTRIBUTES = new Set(["class", ...ALLOWED_ATTR.slice(8)]);

const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
const TEMML_EXACT_CLASSES = new Set([
	"actuarial",
	"circle-pad",
	"downstrike",
	"longdiv-arc",
	"longdiv-top",
	"mathcal",
	"mathscr",
	"menclose",
	"nobreak",
	"phasor-angle",
	"phasor-bottom",
	"sout",
	"special-fraction",
	"textcircle",
	"upstrike",
]);
const TEMML_CLASS_PREFIX = /^(?:chr|ff|tml|wbk)-[a-z0-9-]+$/;
const TEMML_STYLE_PROPERTIES = new Set([
	"background-color",
	"border",
	"border-bottom",
	"border-left",
	"border-right",
	"border-top",
	"bottom",
	"color",
	"display",
	"font-family",
	"font-style",
	"font-weight",
	"height",
	"justify-content",
	"margin-left",
	"math-depth",
	"padding",
	"padding-bottom",
	"padding-left",
	"padding-right",
	"padding-top",
	"position",
	"right",
	"text-align",
	"transform",
	"width",
]);

function isMathMlElement(node: Element): boolean {
	return node.namespaceURI === MATHML_NAMESPACE;
}

function sanitizeTemmlStyle(value: string): string {
	const declarations: string[] = [];
	for (const declaration of value.split(";")) {
		const separator = declaration.indexOf(":");
		if (separator < 1) continue;
		const property = declaration.slice(0, separator).trim().toLowerCase();
		const propertyValue = declaration.slice(separator + 1).trim();
		if (!TEMML_STYLE_PROPERTIES.has(property)) continue;
		if (!propertyValue || /(?:url|expression|javascript|!important|var\s*\()/i.test(propertyValue)) continue;
		if (!/^[A-Za-z0-9 .,%()'"+#-]+$/.test(propertyValue)) continue;
		declarations.push(`${property}:${propertyValue}`);
	}
	return declarations.join(";");
}

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

function isAllowedTemmlClass(token: string): boolean {
	return TEMML_EXACT_CLASSES.has(token) || TEMML_CLASS_PREFIX.test(token);
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

	// Hook 1 — keep HTML and MathML attribute policies separate. Temml classes
	// and finite layout styles are valid only on MathML elements.
	dp.addHook("uponSanitizeAttribute", (rawNode, data) => {
		const node = rawNode as Element;
		const isMathMl = isMathMlElement(node);
		const allowedAttributes = isMathMl ? MATHML_ATTRIBUTES : HTML_ATTRIBUTES;
		if (!allowedAttributes.has(data.attrName)) {
			data.keepAttr = false;
			return;
		}
		if (data.attrName === "style") {
			const style = sanitizeTemmlStyle(data.attrValue);
			if (!isMathMl || !style) {
				data.keepAttr = false;
				return;
			}
			data.attrValue = style;
			return;
		}
		if (data.attrName === "class") {
			const isAllowed = isMathMl ? isAllowedTemmlClass : isAllowedClass;
			const kept = data.attrValue.split(/\s+/).filter(t => t.length > 0 && isAllowed(t));
			if (kept.length === 0) {
				data.keepAttr = false;
				return;
			}
			data.attrValue = kept.join(" ");
		}
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
