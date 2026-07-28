/**
 * Level 3 E2E — asserts the derived stealth user-agent override actually LANDS
 * on a page in the Chrome that puppeteer currently bundles.
 *
 * Why this exists separately from the pure unit test:
 * `test/browser/user-agent-override.test.ts` proves the derivation computes the
 * right values and runs in CI on every PR. It cannot prove Chrome accepts them.
 * A puppeteer major bump can change the CDP surface such that
 * `Emulation.setUserAgentOverride` is silently rejected or ignored, leaving the
 * page with no client hints at all — which is itself a strong automation tell.
 *
 * Measured baseline (Chrome 150.0.7871.24, bundled by puppeteer 25.3.0): a page
 * with NO override reports `navigator.userAgentData.brands === []`, an empty
 * platform, and an empty uaFullVersion — verified on Chrome-for-Testing headless
 * and headful, on system Google Chrome 150.0.7871.187 headful, and on a Chrome
 * launched with none of puppeteer's default flags. So "brands is empty" is the
 * before state, and a populated, correctly-ordered brand list is the after
 * state. That gap is what makes this assertion meaningful rather than tautological.
 *
 * `navigator.userAgentData` is only exposed in a secure context, so the fixture
 * is served from 127.0.0.1 (a trustworthy origin) rather than about:blank —
 * on about:blank the API is absent entirely and every assertion here would
 * vacuously "pass" against undefined.
 *
 * LOCAL-ONLY BY DESIGN: launching Chrome needs a real browser download, so this
 * is `describe.skipIf(isCI)` like the rest of the E2E tier.
 * Run: bun test test/e2e/stealth-user-agent.e2e.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Browser, Page } from "puppeteer";
import { deriveUserAgentOverride, type UserAgentOverride } from "../../src/tools/browser-user-agent";

// See the note in extension-e2e.test.ts: never process.exit() from a test module.
// Skip cleanly and import puppeteer dynamically so it never loads on a runner
// without a browser.
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;

type UaDataSnapshot = {
	present: boolean;
	secure?: boolean;
	brands?: Array<{ brand: string; version: string }>;
	platform?: string;
	mobile?: boolean;
	uaFullVersion?: string;
	userAgent?: string;
};

/**
 * Reads client hints from inside the page and stringifies there, so puppeteer's
 * structured clone of `NavigatorUAData` (frozen, getter-backed) cannot flatten
 * the result into a false empty.
 */
async function readUaData(page: Page): Promise<UaDataSnapshot> {
	const json = await page.evaluate(async () => {
		const data = (
			navigator as Navigator & {
				userAgentData?: {
					brands: Array<{ brand: string; version: string }>;
					platform: string;
					mobile: boolean;
					getHighEntropyValues(hints: string[]): Promise<{ uaFullVersion?: string }>;
				};
			}
		).userAgentData;
		if (!data) return JSON.stringify({ present: false });
		const high = await data.getHighEntropyValues(["uaFullVersion"]);
		return JSON.stringify({
			present: true,
			secure: (globalThis as unknown as { isSecureContext: boolean }).isSecureContext,
			brands: data.brands.map(b => ({ brand: b.brand, version: b.version })),
			platform: data.platform,
			mobile: data.mobile,
			uaFullVersion: high.uaFullVersion ?? "",
			userAgent: navigator.userAgent,
		});
	});
	return JSON.parse(json) as UaDataSnapshot;
}

/** Applies the override exactly as BrowserTool#sendUserAgentOverride does. */
async function applyOverride(page: Page, override: UserAgentOverride): Promise<void> {
	const client = await page.createCDPSession();
	await client.send("Network.enable");
	await client.send("Network.setUserAgentOverride", override as unknown as never);
	await client.send("Emulation.setUserAgentOverride", override as unknown as never);
}

describe.skipIf(isCI)("Stealth user-agent override (real Chrome via Puppeteer)", () => {
	let browser: Browser;
	let server: ReturnType<typeof Bun.serve>;
	let fixtureUrl: string;
	let rawUserAgent: string;
	let browserVersion: string;

	beforeAll(async () => {
		const puppeteer = (await import("puppeteer")).default;
		server = Bun.serve({
			port: 0,
			fetch: () =>
				new Response('<!doctype html><html lang="en"><head><title>ua probe</title></head><body></body></html>', {
					headers: { "content-type": "text/html" },
				}),
		});
		fixtureUrl = `http://127.0.0.1:${server.port}/`;
		browser = await puppeteer.launch({ headless: true });
		rawUserAgent = await browser.userAgent();
		browserVersion = await browser.version();
	}, 120_000);

	afterAll(async () => {
		await browser?.close();
		server?.stop(true);
	});

	it("exposes userAgentData on the loopback fixture, so the assertions below are not vacuous", async () => {
		const page = await browser.newPage();
		try {
			await page.goto(fixtureUrl);
			const snapshot = await readUaData(page);
			expect(snapshot.present).toBe(true);
			expect(snapshot.secure).toBe(true);
		} finally {
			await page.close();
		}
	});

	it("reports an EMPTY brand list without the override — the baseline this fixes", async () => {
		const page = await browser.newPage();
		try {
			await page.goto(fixtureUrl);
			const snapshot = await readUaData(page);
			expect(snapshot.brands).toEqual([]);
			expect(snapshot.platform).toBe("");
			expect(snapshot.uaFullVersion).toBe("");
		} finally {
			await page.close();
		}
	});

	it("lands the derived brand list, in the derived order, once the override is applied", async () => {
		const override = deriveUserAgentOverride(rawUserAgent, browserVersion);
		const page = await browser.newPage();
		try {
			await applyOverride(page, override);
			await page.goto(fixtureUrl);
			const snapshot = await readUaData(page);

			// Order matters: Chrome permutes the brand list per major version, and a
			// mismatch between claimed UA version and brand order is itself a tell.
			expect(snapshot.brands).toEqual(override.userAgentMetadata.brands);
			expect(snapshot.brands?.length).toBe(3);
			expect(snapshot.platform).toBe(override.userAgentMetadata.platform);
			expect(snapshot.mobile).toBe(override.userAgentMetadata.mobile);
			expect(snapshot.uaFullVersion).toBe(override.userAgentMetadata.fullVersion);
		} finally {
			await page.close();
		}
	});

	it("presents no HeadlessChrome token in the page's own navigator.userAgent", async () => {
		const override = deriveUserAgentOverride(rawUserAgent, browserVersion);
		const page = await browser.newPage();
		try {
			await applyOverride(page, override);
			await page.goto(fixtureUrl);
			const snapshot = await readUaData(page);
			expect(snapshot.userAgent).not.toInclude("HeadlessChrome");
			expect(snapshot.userAgent).toBe(override.userAgent);
		} finally {
			await page.close();
		}
	});

	it("agrees with the Chrome major version puppeteer actually bundles", async () => {
		// Guards the coupling directly: if a future bump moves the bundled major,
		// the brand ordering changes and this pins that they move together.
		const major = Number.parseInt(browserVersion.match(/\/(\d+)/)?.[1] ?? "0", 10);
		expect(major).toBeGreaterThan(0);
		const override = deriveUserAgentOverride(rawUserAgent, browserVersion);
		const chromium = override.userAgentMetadata.brands.find(b => b.brand === "Chromium");
		expect(chromium?.version).toBe(String(major));
	});
});
