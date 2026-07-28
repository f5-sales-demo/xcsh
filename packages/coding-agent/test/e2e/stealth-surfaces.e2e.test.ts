/**
 * Level 3 E2E — asserts the injected stealth surfaces actually take effect in a
 * real Chrome.
 *
 * Why this exists: every surface is wrapped in its own `try { … } catch {}` so
 * that one failure cannot stop the rest. That is the right call for robustness
 * and terrible for observability — a surface that stops working on a new Chrome
 * fails completely silently. These tests make that failure loud, by asserting
 * (a) the bundle records zero per-surface errors and (b) each surface's
 * observable effect.
 *
 * This suite found a real bug: the bundle's native-cache preamble called
 * `document.head.appendChild(iframe)`, but `evaluateOnNewDocument` runs before
 * ANY DOM exists (`document.readyState === "loading"`, `document.head`,
 * `document.body` and `document.documentElement` all null). So the preamble threw
 * on its first statement, outside every per-surface guard, and all fourteen
 * surfaces silently never ran — `navigator.webdriver` stayed `true`. Reproduced
 * identically on puppeteer 24.43.1 / Chrome 148, so it predates the 25.3.0 bump.
 *
 * LOCAL-ONLY BY DESIGN: needs a real browser, so `describe.skipIf(isCI)` like the
 * rest of the E2E tier. Run: bun test test/e2e/stealth-surfaces.e2e.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Browser, Page } from "puppeteer";
import { buildStealthBundle } from "../../src/tools/browser-stealth";

// See extension-e2e.test.ts: never process.exit() from a test module.
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;

const ERROR_SINK = "__xcshStealthErrors";

type Surfaces = {
	surfaceErrors: Array<{ name: string; message: string }>;
	webdriver: unknown;
	hardwareConcurrency: number;
	language: string;
	languages: string[];
	timezone: string;
	pluginNames: string[];
	mimeTypes: string[];
	webglVendor: unknown;
	webglRenderer: unknown;
	permissionsQueryStringifiesNative: boolean;
	permissionsQueryProtoCallIsNative: boolean;
	chromeRuntimePresent: boolean;
	leftoverIframes: number;
};

/**
 * The page realm's globals. This package's tsconfig has no DOM lib (it is a CLI),
 * so page-side code shapes what it needs off globalThis — same approach as
 * src/tools/browser.ts's own page.evaluate callbacks.
 */
type PageRealm = {
	navigator: {
		webdriver?: unknown;
		hardwareConcurrency: number;
		language: string;
		languages: readonly string[];
		plugins: ArrayLike<{ name: string }>;
		mimeTypes: ArrayLike<{ type: string }>;
		permissions: { query: (...args: unknown[]) => unknown };
	};
	document: {
		createElement(tag: string): {
			getContext(kind: string): {
				getExtension(name: string): { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
				getParameter(p: number): unknown;
			} | null;
		};
		querySelectorAll(sel: string): ArrayLike<unknown>;
	};
	Intl: { DateTimeFormat: (...a: unknown[]) => { resolvedOptions(): { timeZone: string } } };
	chrome?: unknown;
	__xcshStealthErrors?: Array<{ name: string; message: string }>;
};

async function readSurfaces(page: Page): Promise<Surfaces> {
	const json = await page.evaluate(() => {
		const g = globalThis as unknown as PageRealm;
		const gl = g.document.createElement("canvas").getContext("webgl");
		const dbg = gl?.getExtension("WEBGL_debug_renderer_info") ?? null;
		const nav = g.navigator;
		return JSON.stringify({
			surfaceErrors: g.__xcshStealthErrors ?? [],
			// `undefined` would vanish from JSON, which is the very value under test.
			webdriver: typeof nav.webdriver === "undefined" ? "__undefined__" : nav.webdriver,
			hardwareConcurrency: nav.hardwareConcurrency,
			language: nav.language,
			languages: [...nav.languages],
			timezone: g.Intl.DateTimeFormat().resolvedOptions().timeZone,
			pluginNames: Array.from(nav.plugins).map(p => p.name),
			mimeTypes: Array.from(nav.mimeTypes).map(m => m.type),
			webglVendor: gl && dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
			webglRenderer: gl && dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
			// Two spellings, deliberately. The surfaces mask by installing an own
			// `toString` property, so `String(fn)` is masked while
			// `Function.prototype.toString.call(fn)` bypasses the own property and
			// still sees the replacement. That asymmetry is a real limitation of the
			// approach, pinned in the assertions below rather than left implicit.
			permissionsQueryStringifiesNative: String(nav.permissions.query).includes("[native code]"),
			permissionsQueryProtoCallIsNative: Function.prototype.toString
				.call(nav.permissions.query)
				.includes("[native code]"),
			chromeRuntimePresent: typeof g.chrome !== "undefined",
			// The preamble must not leave a helper element behind as a tell.
			leftoverIframes: g.document.querySelectorAll("iframe").length,
		});
	});
	return JSON.parse(json) as Surfaces;
}

describe.skipIf(isCI)("Stealth injected surfaces (real Chrome via Puppeteer)", () => {
	let browser: Browser;
	let server: ReturnType<typeof Bun.serve>;
	let fixtureUrl: string;
	let stealthed: Surfaces;
	let bare: Surfaces;

	beforeAll(async () => {
		const puppeteer = (await import("puppeteer")).default;
		server = Bun.serve({
			port: 0,
			fetch: () =>
				new Response('<!doctype html><html lang="en"><head><title>surfaces</title></head><body></body></html>', {
					headers: { "content-type": "text/html" },
				}),
		});
		fixtureUrl = `http://127.0.0.1:${server.port}/`;
		browser = await puppeteer.launch({ headless: true });

		const barePage = await browser.newPage();
		await barePage.goto(fixtureUrl);
		bare = await readSurfaces(barePage);
		await barePage.close();

		const page = await browser.newPage();
		await page.evaluateOnNewDocument(buildStealthBundle({ errorSink: ERROR_SINK }));
		await page.goto(fixtureUrl);
		stealthed = await readSurfaces(page);
		await page.close();
	}, 180_000);

	afterAll(async () => {
		await browser?.close();
		server?.stop(true);
	});

	it("runs every surface without a swallowed error", () => {
		// Names the offender rather than just failing a count.
		expect(stealthed.surfaceErrors).toEqual([]);
	});

	it("hides navigator.webdriver, the most basic automation tell", () => {
		expect(bare.webdriver).toBe(true);
		expect(stealthed.webdriver).toBe("__undefined__");
	});

	it("spoofs hardwareConcurrency to the profile's value", () => {
		expect(stealthed.hardwareConcurrency).toBe(4);
	});

	it("presents a consistent locale profile", () => {
		expect(stealthed.language).toBe("en-US");
		expect(stealthed.languages).toEqual(["en-US", "en"]);
		expect(stealthed.timezone).toBe("America/New_York");
	});

	it("changes something at all — guards against a bundle that silently no-ops", () => {
		// The bug this suite found made every single surface identical to bare.
		const changed =
			stealthed.webdriver !== bare.webdriver ||
			stealthed.hardwareConcurrency !== bare.hardwareConcurrency ||
			stealthed.languages.join() !== bare.languages.join();
		expect(changed).toBe(true);
	});

	it("keeps a plugin list that is non-empty and PDF-capable", () => {
		expect(stealthed.pluginNames.length).toBeGreaterThan(0);
		expect(stealthed.mimeTypes).toContain("application/pdf");
	});

	it("reports a WebGL vendor and renderer rather than a SwiftShader giveaway", () => {
		expect(typeof stealthed.webglVendor).toBe("string");
		expect(typeof stealthed.webglRenderer).toBe("string");
		expect(String(stealthed.webglRenderer)).not.toInclude("SwiftShader");
	});

	it("keeps a replaced permissions.query stringifying as native code", () => {
		expect(stealthed.permissionsQueryStringifiesNative).toBe(true);
	});

	it("does NOT survive Function.prototype.toString.call — a known limitation, pinned", () => {
		// The surfaces mask by installing an own `toString` property, which
		// `Function.prototype.toString.call(fn)` deliberately ignores. Defeating that
		// needs a patched Function.prototype.toString, which this bundle does not do
		// (nothing in src/tools/puppeteer/*.txt touches it). Asserting the CURRENT
		// behaviour means a future change to close the gap re-evaluates this
		// expectation instead of silently assuming it.
		expect(stealthed.permissionsQueryProtoCallIsNative).toBe(false);
	});

	it("leaves no helper iframe behind in the document", () => {
		expect(stealthed.leftoverIframes).toBe(0);
	});
});
