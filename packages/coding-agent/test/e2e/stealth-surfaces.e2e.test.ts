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
import { locateChrome } from "../../src/browser/chrome-locate";
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
		body: { appendChild(el: unknown): void };
		createElement(tag: string): {
			getContext(kind: string): {
				getExtension(name: string): { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
				getParameter(p: number): unknown;
			} | null;
		};
		querySelectorAll(sel: string): ArrayLike<unknown>;
	};
	Intl: {
		DateTimeFormat: new (...a: unknown[]) => { resolvedOptions(): { timeZone: string }; format(d: unknown): string };
	};
	Date: new (...a: unknown[]) => { getTimezoneOffset(): number; toString(): string };
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
			timezone: new g.Intl.DateTimeFormat().resolvedOptions().timeZone,
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
		browser = await puppeteer.launch({ headless: true, executablePath: locateChrome()?.path });

		const barePage = await browser.newPage();
		await barePage.goto(fixtureUrl);
		bare = await readSurfaces(barePage);
		await barePage.close();

		const page = await browser.newPage();
		await page.evaluateOnNewDocument(buildStealthBundle({ errorSink: ERROR_SINK }));
		// Mirrors BrowserTool#applyTimezoneOverride: the timezone is a CDP override,
		// not a page-script patch, so a page-script-only harness would not represent
		// what ships.
		const client = await page.createCDPSession();
		await client.send("Emulation.setTimezoneOverride", { timezoneId: "America/New_York" });
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

	it("does NOT break a caller's explicit timeZone", async () => {
		// Regression: the locale surface used to force its own zone into every
		// Intl.DateTimeFormat call, so a page asking for UTC got New York — 08:00
		// where it wanted 12:00. Corrupting a page's formatted output is far worse
		// than the tell it was trying to hide.
		const page = await browser.newPage();
		try {
			await page.evaluateOnNewDocument(buildStealthBundle({ errorSink: ERROR_SINK }));
			const client = await page.createCDPSession();
			await client.send("Emulation.setTimezoneOverride", { timezoneId: "America/New_York" });
			await page.goto(fixtureUrl);
			const result = await page.evaluate(() => {
				const g = globalThis as unknown as PageRealm;
				const at = new g.Date(Date.UTC(2026, 6, 28, 12, 0));
				return JSON.stringify({
					explicitUTC: new g.Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).resolvedOptions().timeZone,
					explicitTokyo: new g.Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo" }).resolvedOptions().timeZone,
					formattedUTC: new g.Intl.DateTimeFormat("en-US", {
						timeZone: "UTC",
						hour: "numeric",
						hour12: false,
					}).format(at),
					offset: new g.Date().getTimezoneOffset(),
					dateString: at.toString(),
				});
			});
			const parsed = JSON.parse(result) as {
				explicitUTC: string;
				explicitTokyo: string;
				formattedUTC: string;
				offset: number;
				dateString: string;
			};
			expect(parsed.explicitUTC).toBe("UTC");
			expect(parsed.explicitTokyo).toBe("Asia/Tokyo");
			expect(parsed.formattedUTC).toBe("12");
			// Consistency: the numeric offset must match the zone actually claimed.
			// America/New_York in July is EDT, i.e. UTC-4 -> 240. The old textual
			// Date rewrite hardcoded "Eastern Standard Time" while the offset stayed
			// EDT, which is self-contradictory and trivially detectable.
			expect(parsed.offset).toBe(240);
			expect(parsed.dateString).toInclude("Eastern Daylight Time");
			expect(parsed.dateString).not.toInclude("Eastern Standard Time");
		} finally {
			await page.close();
		}
	});

	it("keeps iframe srcdoc working", async () => {
		// Regression: the iframe surface redefined srcdoc as a NON-WRITABLE data
		// property and then assigned through the same element, so the write failed
		// against its own frozen property and the native setter was never reached.
		// Every dynamically created srcdoc iframe loaded empty.
		const page = await browser.newPage();
		try {
			await page.evaluateOnNewDocument(buildStealthBundle({ errorSink: ERROR_SINK }));
			await page.goto(fixtureUrl);
			const loaded = await page.evaluate(async () => {
				const g = globalThis as unknown as PageRealm & {
					document: { body: { appendChild(el: unknown): void } };
				};
				const frame = g.document.createElement("iframe") as unknown as {
					srcdoc: string;
					getAttribute(n: string): string | null;
					onload: (() => void) | null;
					contentDocument: { getElementById(id: string): { textContent: string } | null } | null;
					remove(): void;
				};
				frame.srcdoc = "<p id=hit>LOADED</p>";
				g.document.body.appendChild(frame);
				await new Promise<void>(resolve => {
					frame.onload = () => resolve();
					setTimeout(resolve, 1000);
				});
				const text = frame.contentDocument?.getElementById("hit")?.textContent ?? null;
				const attr = frame.getAttribute("srcdoc");
				const prop = frame.srcdoc;
				frame.remove();
				return JSON.stringify({ text, attr, prop });
			});
			const parsed = JSON.parse(loaded) as { text: string | null; attr: string | null; prop: string };
			expect(parsed.text).toBe("LOADED");
			expect(parsed.attr).toBe("<p id=hit>LOADED</p>");
			expect(parsed.prop).toBe("<p id=hit>LOADED</p>");
		} finally {
			await page.close();
		}
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

	it("does not break ordinary web APIs", async () => {
		// Both defects this suite found were FUNCTIONAL breakage, not fingerprinting
		// slips: srcdoc silently stopped loading, and explicit timezones formatted
		// the wrong hour. Fourteen surfaces patch a lot of the platform, so the
		// question "does the page still work" needs its own assertion rather than
		// being inferred from the absence of thrown errors — the surface guards
		// swallow, so nothing throws either way.
		const page = await browser.newPage();
		try {
			await page.evaluateOnNewDocument(buildStealthBundle({ errorSink: ERROR_SINK }));
			await page.goto(fixtureUrl);
			const json = await page.evaluate(async () => {
				const w = globalThis as unknown as {
					fetch: (u: string) => Promise<{ status: number }>;
					XMLHttpRequest: new () => {
						onload: (() => void) | null;
						onerror: (() => void) | null;
						status: number;
						open(m: string, u: string): void;
						send(): void;
					};
					OfflineAudioContext: new (
						c: number,
						l: number,
						r: number,
					) => {
						destination: unknown;
						createOscillator(): { connect(d: unknown): void; start(): void };
						startRendering(): Promise<{ length: number }>;
					};
					localStorage: {
						setItem(k: string, v: string): void;
						getItem(k: string): string | null;
						removeItem(k: string): void;
					};
					document: {
						createElement(t: string): {
							getContext(k: string): {
								font: string;
								measureText(t: string): { width: number };
								getImageData(a: number, b: number, c: number, d: number): { data: { length: number } };
							} | null;
							toDataURL(): string;
							canPlayType(t: string): string;
							width: number;
							height: number;
						};
					};
					navigator: { permissions: { query(d: { name: string }): Promise<{ state: string }> } };
					Date: new (n: number) => { toLocaleString(l: string): string };
				};
				const out: Record<string, unknown> = {};
				out.fetchStatus = (await w.fetch("/")).status;
				out.xhrStatus = await new Promise<number | string>(res => {
					const x = new w.XMLHttpRequest();
					x.onload = () => res(x.status);
					x.onerror = () => res("error");
					x.open("GET", "/");
					x.send();
				});
				const ctx2d = w.document.createElement("canvas").getContext("2d");
				ctx2d!.font = "20px monospace";
				out.measuredWidth = Math.round(ctx2d!.measureText("abc").width);
				out.dataUrlPrefix = w.document.createElement("canvas").toDataURL().slice(0, 15);
				const sized = w.document.createElement("canvas");
				sized.width = 2;
				sized.height = 2;
				out.imageDataLength = sized.getContext("2d")!.getImageData(0, 0, 2, 2).data.length;
				out.canPlayMp4 = w.document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"');
				const audio = new w.OfflineAudioContext(1, 128, 44100);
				const osc = audio.createOscillator();
				osc.connect(audio.destination);
				osc.start();
				out.renderedFrames = (await audio.startRendering()).length;
				w.localStorage.setItem("k", "v");
				out.storageRoundTrip = w.localStorage.getItem("k");
				w.localStorage.removeItem("k");
				out.permissionState = (await w.navigator.permissions.query({ name: "geolocation" })).state;
				// 15:04 UTC in January is 10:04 in New York (EST, UTC-5). Catches a
				// timezone override that shifts Intl but not Date, or vice versa.
				out.localised = new w.Date(Date.UTC(2026, 0, 2, 15, 4)).toLocaleString("en-US");
				return JSON.stringify(out);
			});
			const r = JSON.parse(json) as Record<string, unknown>;
			expect(r.fetchStatus).toBe(200);
			expect(r.xhrStatus).toBe(200);
			expect(r.measuredWidth).toBe(36);
			expect(r.dataUrlPrefix).toBe("data:image/png;");
			expect(r.imageDataLength).toBe(16);
			expect(r.canPlayMp4).toBe("probably");
			expect(r.renderedFrames).toBe(128);
			expect(r.storageRoundTrip).toBe("v");
			expect(r.permissionState).toBe("prompt");
			expect(r.localised).toBe("1/2/2026, 10:04:00 AM");
		} finally {
			await page.close();
		}
	});

	it("leaves no helper iframe behind in the document", () => {
		expect(stealthed.leftoverIframes).toBe(0);
	});
});
