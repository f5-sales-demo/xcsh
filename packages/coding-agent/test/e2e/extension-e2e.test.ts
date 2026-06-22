/**
 * Level 3 E2E Tests — Puppeteer loads the REAL extension in a real Chrome.
 *
 * This is the missing testing layer: the extension + service worker + native
 * messaging bridge + content scripts all run in a real browser, exercised
 * programmatically without needing the user to watch or interact.
 *
 * Based on:
 * - https://developer.chrome.com/docs/extensions/how-to/test/puppeteer
 * - https://developer.chrome.com/docs/extensions/how-to/test/test-serviceworker-termination-with-puppeteer
 * - https://developer.chrome.com/blog/eyeos-journey-to-testing-mv3-service-worker-suspension
 *
 * Prerequisites:
 * - The extension is built (`bun run build` in xcsh-chrome-extension)
 * - The native host manifest is installed (`xcsh chrome setup`)
 *
 * Run: bun test test/e2e/extension-e2e.test.ts
 * (Requires a display — these tests launch a visible Chrome.)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// E2E tests require a display + the real Chrome extension loaded — skip in CI.
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
if (isCI) {
	console.log("Skipping E2E tests in CI (no display / no extension).");
	// @ts-expect-error — Bun's describe.skip
	describe.skip("Extension E2E (skipped in CI)", () => {
		it("placeholder", () => {});
	});
	// biome-ignore lint: early exit in CI
	process.exit(0);
}

import type { Browser, WebWorker } from "puppeteer";
import puppeteer from "puppeteer";
import { type BridgeServer, startBridgeServer } from "../../src/browser/extension-bridge";

const EXT_PATH = "/Users/r.mordasiewicz/GIT/web-search/xcsh-chrome-extension/dist";
const CONSOLE_URL =
	"https://nferreira.staging.volterra.us/web/workspaces/web-app-and-api-protection/namespaces/demo/manage/load_balancers/http_loadbalancers";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let browser: Browser;
let server: BridgeServer;
let worker: WebWorker | null = null;

// --- Lifecycle ---

beforeAll(async () => {
	// 1. Start the bridge server (xcsh side of the native-messaging pipeline).
	server = await startBridgeServer();

	// 2. Launch Chrome with the extension loaded via Puppeteer 24.x API.
	browser = await puppeteer.launch({
		headless: false,
		pipe: true, // required for enableExtensions with path list
		enableExtensions: [EXT_PATH],
	});

	// 3. Wait for the extension's service worker to start.
	const swTarget = await browser.waitForTarget(
		t => t.type() === "service_worker" && t.url().includes("service-worker"),
		{ timeout: 20_000 },
	);
	worker = await swTarget.worker();

	// 4. Wait for the bridge connection (SW → native host → xcsh socket).
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline && !server.connected) {
		await sleep(500);
	}
}, 60_000);

afterAll(async () => {
	await browser?.close().catch(() => {});
	await server?.close().catch(() => {});
}, 15_000);

// --- Helper ---

async function tool(name: string, params: Record<string, unknown> = {}, timeout = 30_000) {
	const r = await server.request(name, params, timeout);
	if (r.is_error) throw new Error(`${name}: ${JSON.stringify(r.content)}`);
	return r.content as Record<string, unknown>;
}

// --- Level 3: E2E Tests ---

describe("Extension E2E (Puppeteer + real Chrome)", () => {
	it("extension loads and service worker starts", () => {
		expect(worker).not.toBeNull();
	}, 30_000);

	it("bridge connects via native messaging", () => {
		expect(server.connected).toBe(true);
	}, 30_000);

	it("ping round-trip through the full pipeline", async () => {
		const pong = await tool("ping");
		expect(pong).toMatchObject({ ok: true, version: "0.1.0" });
	}, 30_000);

	it("navigate opens a console tab", async () => {
		const nav = await tool("navigate", { url: CONSOLE_URL }, 45_000);
		expect(nav).toHaveProperty("tabId");
	}, 60_000);

	it("read_ax returns a non-trivial AX tree from the console", async () => {
		const tree = (await tool("read_ax", {}, 30_000)) as { role?: string; children?: unknown[] };
		expect(tree).toHaveProperty("role");
		// Count nodes
		const flat: string[] = [];
		(function walk(n: any) {
			if (!n) return;
			flat.push(`${n.role}:${n.name?.slice(0, 30)}`);
			(n.children || []).forEach(walk);
		})(tree);
		expect(flat.length).toBeGreaterThan(10);
	}, 45_000);

	it("read_ax response fits under the 1MB native-messaging limit", async () => {
		const tree = await tool("read_ax", {}, 30_000);
		const size = JSON.stringify(tree).length;
		expect(size).toBeLessThan(900_000);
	}, 45_000);

	it("find resolves a text selector on the console", async () => {
		const found = (await tool("find", { selector: "text('HTTP Load Balancers')" }, 30_000)) as {
			refs?: Array<{ ref: string }>;
		};
		expect(found.refs?.length).toBeGreaterThan(0);
	}, 45_000);

	it("get_page_text returns content", async () => {
		const pt = (await tool("get_page_text", {}, 15_000)) as { text?: string };
		expect((pt.text ?? "").length).toBeGreaterThan(50);
	}, 30_000);

	it("javascript_tool returns the page title", async () => {
		const j = (await tool("javascript_tool", { code: "document.title" }, 15_000)) as { result?: string };
		expect(j.result).toContain("Load Balancers");
	}, 30_000);

	it("tabs_list shows the console tab", async () => {
		const t = (await tool("tabs_list", {}, 10_000)) as { tabs?: unknown[] };
		expect((t.tabs ?? []).length).toBeGreaterThan(0);
	}, 30_000);

	it("screenshot returns data or a clear size error (never a silent timeout)", async () => {
		let gotData = false;
		let gotSizeError = false;
		try {
			const s = (await tool("screenshot", {}, 15_000)) as { data?: string };
			if (s.data && s.data.length > 0) gotData = true;
		} catch (e: unknown) {
			const msg = (e as Error).message;
			if (/too large|size|900/i.test(msg)) gotSizeError = true;
			else throw e; // unexpected error — re-throw
		}
		expect(gotData || gotSizeError).toBe(true);
	}, 30_000);

	it("click resolves a ref and dispatches a mouse event", async () => {
		const found = (await tool("find", { selector: "tab:text('Add HTTP Load Balancer')" }, 30_000)) as {
			refs?: Array<{ ref: string }>;
		};
		expect(found.refs?.length).toBeGreaterThan(0);
		const ref = found.refs![0].ref;
		const click = (await tool("click", { ref }, 15_000)) as { clicked: string; x: number; y: number };
		expect(click.clicked).toBe(ref);
		expect(typeof click.x).toBe("number");
	}, 45_000);

	it("navigate dedup — skips when tab URL already matches target", async () => {
		// First navigate to a URL, then navigate to the same URL — should be instant (dedup).
		const start = Date.now();
		await tool("navigate", { url: CONSOLE_URL }, 30_000);
		const elapsed = Date.now() - start;
		// A dedup should return in <2s (no waitForNavigation / waitForSettle).
		expect(elapsed).toBeLessThan(5000);
	}, 45_000);

	it("resize_window works", async () => {
		const r = await tool("resize_window", { width: 1280, height: 900 }, 10_000);
		expect(r).toMatchObject({ resized: { width: 1280, height: 900 } });
	}, 15_000);

	it("detach cleans up the debugger", async () => {
		const d = await tool("detach", {}, 10_000);
		expect(d).toMatchObject({ detached: true });
	}, 15_000);
});

describe("Service Worker termination + recovery (eyeo pattern)", () => {
	it("SW survives termination: stop → reconnect → ping", async () => {
		// Stop the SW (Google's official pattern).
		if (worker) await worker.close();

		// Wait for reconnect (the SW's 30s alarm restarts it + reconnects native port).
		const deadline = Date.now() + 45_000;
		while (Date.now() < deadline) {
			if (server.connected) break;
			await sleep(1000);
		}
		expect(server.connected).toBe(true);

		// Ping after recovery.
		const pong = await tool("ping", {}, 10_000);
		expect(pong).toMatchObject({ ok: true });

		// Re-acquire the worker reference for subsequent tests.
		const swTarget = await browser.waitForTarget(
			t => t.type() === "service_worker" && t.url().includes("service-worker"),
			{ timeout: 15_000 },
		);
		worker = await swTarget.worker();
	}, 90_000);
});
