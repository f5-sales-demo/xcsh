/**
 * Preloaded FIRST for the markdown test suite so a SPEC-FAITHFUL DOM (jsdom) is
 * the global `window`/`document` before any DOM-touching code runs.
 *
 * Why jsdom here and happy-dom elsewhere: the markdown renderer's security
 * boundary is a DOMPurify pass, and DOMPurify walks the parsed DOM with a
 * `NodeIterator`. happy-dom's iterator/HTML-tree construction is not fully HTML5
 * faithful for structural containers (`<table>`, `<pre>`, `<ul>`, `<blockquote>`,
 * `<hr>`), so under happy-dom DOMPurify spuriously drops those wrappers — a
 * TEST-HARNESS artifact, not a product bug (the eval spec flags this exact
 * happy-dom-vs-WebView gap and makes the Chromium/Puppeteer layer authoritative).
 * jsdom reproduces real-browser DOMPurify output, so the golden/XSS assertions
 * here match what the Office WebView actually renders. This is a devDependency
 * used ONLY by tests; `src/` stays browser-safe (dompurify browser build).
 *
 * Must NOT import `@testing-library/*` (that would defeat the register-first
 * ordering, exactly as the happy-dom `register-dom.ts` preload documents).
 */
import { JSDOM } from "jsdom";

if (typeof window === "undefined" || !(globalThis as { document?: unknown }).document) {
	const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
		url: "https://localhost/",
		pretendToBeVisual: true,
	});
	const { window: jsdomWindow } = dom;
	const g = globalThis as Record<string, unknown>;

	// Copy every window own-property that the global scope does not already carry
	// (HTMLElement, Node, Element, Event, DOMParser, NodeFilter, getComputedStyle,
	// requestAnimationFrame, …) so React DOM + Testing Library + DOMPurify resolve
	// the same realm.
	for (const key of Object.getOwnPropertyNames(jsdomWindow)) {
		if (key in g) continue;
		try {
			g[key] = (jsdomWindow as unknown as Record<string, unknown>)[key];
		} catch {
			// Some accessors throw when read off the window; skip them.
		}
	}

	g.window = jsdomWindow;
	g.document = jsdomWindow.document;
	// `navigator` is a read-only getter on the Bun global; define it explicitly so
	// Testing Library's user-event / clipboard probes resolve to jsdom's navigator.
	try {
		Object.defineProperty(g, "navigator", { value: jsdomWindow.navigator, configurable: true, writable: true });
	} catch {
		// Already defined and non-configurable — leave the existing navigator.
	}
}
