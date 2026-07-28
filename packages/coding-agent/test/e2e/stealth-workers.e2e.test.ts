/**
 * Level 3 E2E — workers must still work with the stealth bundle applied, and must
 * not leak an un-spoofed identity.
 *
 * Background (#2560): `13_stealth_worker.txt` rewrote every `Worker` and
 * `SharedWorker` construction to a `blob:` URL carrying a prelude that redefined
 * `navigator.userAgent` inside the worker realm. Measured against real Chrome 150,
 * that surface was net-harmful:
 *
 *   - A worker created with a RELATIVE url failed outright — the blob's base URL is
 *     the blob itself, so the forwarded `importScripts("/w.js")` could not resolve:
 *     "Failed to execute 'importScripts' on 'WorkerGlobalScope': The URL '/w.js' is
 *     invalid." `new Worker("/worker.js")` is the ordinary case.
 *   - Under `worker-src 'self'` the blob was refused by CSP and the worker died,
 *     asynchronously, so the constructor's try/catch fallback never saw it.
 *   - The prelude was dead code regardless: it called `Object_defineProperty`, a
 *     binding from the page-realm bundle scope that a worker realm does not
 *     inherit, inside its own `try {} catch {}`.
 *   - And it was unnecessary. Chrome already propagates the page's CDP user-agent
 *     override into workers: with no surface at all, a worker reports the spoofed
 *     UA *and* the full spoofed brand list, which the prelude could never set.
 *
 * So the surface was removed. These tests are what stops it, or anything like it,
 * coming back.
 *
 * LOCAL-ONLY BY DESIGN: needs a real browser, so `describe.skipIf(isCI)` like the
 * rest of the E2E tier. Run: bun test test/e2e/stealth-workers.e2e.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Browser } from "puppeteer";
import { buildStealthBundle } from "../../src/tools/browser-stealth";
import { deriveUserAgentOverride } from "../../src/tools/browser-user-agent";

// See extension-e2e.test.ts: never process.exit() from a test module.
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;

/** A same-origin worker that reports what its own realm sees. */
const WORKER_JS = `
self.onmessage = () => {
	self.postMessage(JSON.stringify({
		ua: navigator.userAgent,
		brands: navigator.userAgentData ? navigator.userAgentData.brands.map(b => b.brand) : null,
	}));
};
`;

type WorkerOutcome = {
	pageUa: string;
	worker?: { ua: string; brands: string[] | null } | "TIMEOUT";
	workerError?: string;
	constructorThrew?: string;
};

/**
 * Creates a worker from a RELATIVE url — the ordinary spelling, and the one the
 * removed surface broke — then reports what the worker realm sees.
 */
const RUN_WORKER = () =>
	new Promise<string>(resolve => {
		type PageWorker = {
			onmessage: ((e: { data: string }) => void) | null;
			onerror: ((e: { message?: string }) => void) | null;
			postMessage(m: string): void;
		};
		const g = globalThis as unknown as {
			navigator: { userAgent: string };
			Worker: new (u: string) => PageWorker;
		};
		const out: Record<string, unknown> = { pageUa: g.navigator.userAgent };
		let worker: PageWorker;
		try {
			worker = new g.Worker("/w.js");
		} catch (e) {
			out.constructorThrew = String((e as Error)?.message ?? e);
			resolve(JSON.stringify(out));
			return;
		}
		const timer = setTimeout(() => {
			out.worker = "TIMEOUT";
			resolve(JSON.stringify(out));
		}, 4000);
		worker.onmessage = e => {
			clearTimeout(timer);
			out.worker = JSON.parse(e.data);
			resolve(JSON.stringify(out));
		};
		worker.onerror = e => {
			clearTimeout(timer);
			// A CSP refusal arrives as an error event with no message.
			out.workerError = e.message ?? "error event (no message)";
			resolve(JSON.stringify(out));
		};
		worker.postMessage("go");
	});

describe.skipIf(isCI)("Workers under the stealth bundle (real Chrome via Puppeteer)", () => {
	let browser: Browser;

	beforeAll(async () => {
		const puppeteer = (await import("puppeteer")).default;
		browser = await puppeteer.launch({ headless: true });
	}, 180_000);

	afterAll(async () => {
		await browser?.close();
	});

	/** Serves the page (optionally with a CSP) plus the worker script. */
	function serve(csp?: string) {
		return Bun.serve({
			port: 0,
			fetch(req) {
				if (new URL(req.url).pathname === "/w.js") {
					return new Response(WORKER_JS, { headers: { "content-type": "application/javascript" } });
				}
				const headers: Record<string, string> = { "content-type": "text/html" };
				if (csp) headers["content-security-policy"] = csp;
				return new Response('<!doctype html><html lang="en"><head><title>w</title></head><body></body></html>', {
					headers,
				});
			},
		});
	}

	async function runWorker(options: { csp?: string; withUaOverride?: boolean }): Promise<WorkerOutcome> {
		const server = serve(options.csp);
		const page = await browser.newPage();
		try {
			await page.evaluateOnNewDocument(buildStealthBundle({ errorSink: "__xcshStealthErrors" }));
			if (options.withUaOverride) {
				const override = deriveUserAgentOverride(await browser.userAgent(), await browser.version());
				const client = await page.createCDPSession();
				await client.send("Network.enable");
				await client.send("Network.setUserAgentOverride", override as unknown as never);
				await client.send("Emulation.setUserAgentOverride", override as unknown as never);
			}
			await page.goto(`http://127.0.0.1:${server.port}/`);
			return JSON.parse(await page.evaluate(RUN_WORKER)) as WorkerOutcome;
		} finally {
			await page.close();
			server.stop(true);
		}
	}

	it("starts a worker created from a relative URL", async () => {
		const result = await runWorker({});
		// The removed surface failed here with
		// "Failed to execute 'importScripts' ... The URL '/w.js' is invalid."
		expect(result.constructorThrew).toBeUndefined();
		expect(result.workerError).toBeUndefined();
		expect(result.worker).not.toBe("TIMEOUT");
	}, 60_000);

	it("starts a worker under a CSP that allows only same-origin workers", async () => {
		// `worker-src 'self'` is an ordinary policy and does NOT permit blob:. The
		// refusal arrived asynchronously, so the constructor's fallback never caught it.
		const result = await runWorker({ csp: "worker-src 'self'; default-src 'self' 'unsafe-inline'" });
		expect(result.workerError).toBeUndefined();
		expect(result.worker).not.toBe("TIMEOUT");
	}, 60_000);

	it("gives the worker the same spoofed identity as the page, via CDP rather than injection", async () => {
		const result = await runWorker({ withUaOverride: true });
		expect(result.worker).not.toBe("TIMEOUT");
		const worker = result.worker as { ua: string; brands: string[] | null };

		// No HeadlessChrome leak in the worker realm...
		expect(worker.ua).not.toInclude("HeadlessChrome");
		// ...and it matches the page exactly, so the two cannot be compared to
		// detect automation.
		expect(worker.ua).toBe(result.pageUa);
		// The brand list reaches the worker too — something the removed prelude
		// could not do, since it only ever touched userAgent and platform.
		expect(worker.brands).toContain("Google Chrome");
	}, 60_000);
});
