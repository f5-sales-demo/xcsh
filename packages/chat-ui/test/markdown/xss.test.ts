/**
 * LAYER 2 — XSS corpus (jsdom, spec-faithful DOM; see register-jsdom.ts).
 *
 * `marked` passes raw HTML THROUGH, so this is the load-bearing proof that the
 * DOMPurify choke-point (sanitize.ts) neutralizes every hostile construct while
 * legitimate markdown still renders. The Chromium/Puppeteer layer re-runs this
 * corpus as the AUTHORITATIVE oracle; jsdom is the fast pre-flight.
 */
import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../../src/markdown/render";

/** Assertions that must hold for EVERY sanitized output. */
function assertInert(html: string): void {
	expect(html).not.toMatch(/<script/i);
	expect(html).not.toMatch(/<style/i);
	expect(html).not.toMatch(/<iframe/i);
	expect(html).not.toMatch(/<object/i);
	expect(html).not.toMatch(/<svg/i);
	expect(html).not.toMatch(/<img/i);
	expect(html).not.toMatch(/<foreignobject/i);
	// No inline event handlers survive.
	expect(html).not.toMatch(/\son\w+\s*=/i);
	// No dangerous URI scheme survives (decoded or literal) in any attribute.
	expect(html).not.toMatch(/(?:href|src)\s*=\s*["']?\s*(?:javascript|data|vbscript):/i);
	expect(html).not.toMatch(/javascript:/i);
	// The `style` attribute is never allowed (alignment uses classes).
	expect(html).not.toMatch(/\sstyle\s*=/i);
}

const PAYLOADS: Record<string, string> = {
	script: "<script>alert(1)</script>",
	imgOnerror: '<img src=x onerror="alert(1)">',
	svgOnload: '<svg onload="alert(1)"></svg>',
	styleTag: "<style>body{display:none}</style>",
	iframe: '<iframe src="https://evil.example"></iframe>',
	object: '<object data="evil.swf"></object>',
	foreignObjectMxss: "<svg><foreignObject><script>alert(1)</script></foreignObject></svg>",
	linkJs: "[click](javascript:alert(1))",
	linkJsMixedCase: "[click](JaVaScRiPt:alert(1))",
	linkJsWhitespace: "[click](java\tscript:alert(1))",
	linkJsEntity: "[click](&#106;avascript:alert(1))",
	linkData: "[click](data:text/html,<script>alert(1)</script>)",
	linkVbscript: "[click](vbscript:msgbox(1))",
	rawAnchorJs: '<a href="javascript:alert(1)">x</a>',
	rawAnchorOnclick: '<a href="https://ok.example" onclick="alert(1)">x</a>',
	tableCellImg: "| h |\n| --- |\n| <img src=x onerror=alert(1)> |",
	classHeaderSpoof: '<div class="header">spoofed chrome</div>',
	classComposerSpoof: '<span class="composer menu">spoofed</span>',
};

describe("Layer 2 — XSS corpus is neutralized", () => {
	for (const [name, md] of Object.entries(PAYLOADS)) {
		test(`${name} is inert`, () => {
			assertInert(renderMarkdown(md));
		});
	}

	test("a forged legacy sentinel token renders as inert text, not markup", () => {
		const html = renderMarkdown("BLOCKPLACEHOLDER0BLOCKPLACEHOLDER <script>alert(1)</script>");
		assertInert(html);
		expect(html).toContain("BLOCKPLACEHOLDER0BLOCKPLACEHOLDER");
	});

	test("class attributes are filtered to the enumerated allow-list (no chrome spoofing)", () => {
		const el = document.createElement("div");
		el.innerHTML = renderMarkdown('<div class="header composer menu language-ts md-align-left">x</div>');
		const div = el.querySelector("div");
		// Content-supplied chrome classes are stripped; only allow-listed ones remain.
		expect(div?.classList.contains("header")).toBe(false);
		expect(div?.classList.contains("composer")).toBe(false);
		expect(div?.classList.contains("menu")).toBe(false);
		expect(div?.classList.contains("language-ts")).toBe(true);
		expect(div?.classList.contains("md-align-left")).toBe(true);
	});

	test("a hostile fence info string cannot inject a class or markup", () => {
		const html = renderMarkdown("```<script>alert(1)</script>\nbody\n```");
		assertInert(html);
		// The info string was rejected by sanitizeLang → no language-* class emitted.
		expect(html).not.toContain("language-<");
		expect(html).toContain("body");
	});

	test("legitimate markdown still renders alongside a stripped payload", () => {
		const el = document.createElement("div");
		el.innerHTML = renderMarkdown("**safe bold** and <img src=x onerror=alert(1)> and `code`");
		expect(el.querySelector("strong")?.textContent).toBe("safe bold");
		expect(el.querySelector("code")?.textContent).toBe("code");
		expect(el.querySelector("img")).toBeNull();
	});

	test("a safe link keeps its href but gains hardened target/rel", () => {
		const el = document.createElement("div");
		el.innerHTML = renderMarkdown("[docs](https://f5.com)");
		const a = el.querySelector("a");
		expect(a?.getAttribute("href")).toBe("https://f5.com");
		expect(a?.getAttribute("target")).toBe("_blank");
		expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
	});
});
