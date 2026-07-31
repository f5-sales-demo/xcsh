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
// IMPORTANT: never `process.exit()` from a test module. It terminates the whole
// `bun test` runner with that exit code, masking every other test's result (a
// `process.exit(0)` here silently turned the entire xcsh suite green in CI — see
// issue #1903). Skip cleanly with `describe.skipIf(isCI)` and import puppeteer
// dynamically inside `beforeAll` so it never loads on a runner without Chrome.
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Browser, WebWorker } from "puppeteer";
import { type BridgeServer, startBridgeServer } from "../../src/browser/extension-bridge";

// `chrome` is the extension API available inside worker.evaluate() callbacks —
// they execute in the service-worker realm, not this test process.
declare const chrome: {
	tabs: { query(queryInfo: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>> };
};

const EXT_PATH = process.env.XCSH_EXT_DIST ?? "/Users/example/GIT/f5-sales-demo/xcsh-chrome-extension/dist";

// Local, hermetic fixture standing in for the F5 XC console. The live staging
// console requires an authenticated Okta session that a fresh Puppeteer profile
// does not have, which made the content assertions (find/click/title) flaky and
// environment-dependent. This static page carries exactly the anchors the tools
// assert against — the "HTTP Load Balancers" heading, an "Add HTTP Load Balancer"
// tab, a real <title>, and enough DOM for a non-trivial AX tree. Served on a
// loopback port assigned in beforeAll (see `CONSOLE_URL`).
const CONSOLE_FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>HTTP Load Balancers | F5 Distributed Cloud Console</title></head>
<body>
  <header><h1>HTTP Load Balancers</h1></header>
  <nav role="tablist" aria-label="Load balancer actions">
    <button role="tab" id="add-lb">Add HTTP Load Balancer</button>
    <button role="tab">Manage Configuration</button>
    <button role="tab">Delete</button>
  </nav>
  <main>
    <p>This page lists the HTTP load balancers configured in the demo namespace.
       Use the tabs above to add, manage, or remove a load balancer.</p>
    <table>
      <thead><tr><th>Name</th><th>Domain</th><th>State</th></tr></thead>
      <tbody>
        <tr><td>web-lb</td><td>example.com</td><td>Active</td></tr>
        <tr><td>api-lb</td><td>api.example.com</td><td>Active</td></tr>
      </tbody>
    </table>
  </main>
</body>
</html>`;

// The extension only operates on its scoped console domains (`*.volterra.us`,
// `*.console.ves.volterra.io`) — hardcoded in the SW, no test override. So we
// serve the fixture over TLS on loopback and map a real console host onto it via
// Chrome's --host-resolver-rules, keeping the URL inside the allowlist while the
// bytes come from the local fixture. A throwaway self-signed cert + Chrome's
// --ignore-certificate-errors covers the TLS mismatch.
const CONSOLE_HOST = "demo.staging.volterra.us";

let fixtureServer: { stop: () => void } | undefined;
let certDir: string | undefined;
// Assigned once the loopback fixture server is listening (beforeAll).
let CONSOLE_URL = "";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let browser: Browser;
let server: BridgeServer;
let worker: WebWorker | null = null;
let boundTabId: number | null = null;

// --- Lifecycle ---
// The whole suite is skipped in CI (no display / no Chrome). `skipIf` means the
// hooks below never run there, so the dynamic puppeteer import stays inert.
describe.skipIf(isCI)("Extension E2E (real Chrome via Puppeteer)", () => {
	beforeAll(async () => {
		// 0. Serve the hermetic console fixture over TLS on a loopback port, behind
		//    a throwaway self-signed cert.
		certDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-e2e-cert-"));
		const keyPath = path.join(certDir, "key.pem");
		const certPath = path.join(certDir, "cert.pem");
		const gen = spawnSync(
			"openssl",
			// biome-ignore format: readable arg list
			["req", "-x509", "-newkey", "rsa:2048", "-nodes",
			 "-keyout", keyPath, "-out", certPath, "-days", "3650",
			 "-subj", `/CN=${CONSOLE_HOST}`],
			{ stdio: "ignore" },
		);
		if (gen.status !== 0) throw new Error("E2E: failed to generate self-signed cert (openssl required)");

		const fx = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			tls: { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
			fetch: () => new Response(CONSOLE_FIXTURE_HTML, { headers: { "content-type": "text/html" } }),
		});
		fixtureServer = { stop: () => fx.stop(true) };
		// Real console host (passes the extension's scoped-domain allowlist); Chrome
		// resolves it to the local fixture via --host-resolver-rules below.
		CONSOLE_URL = `https://${CONSOLE_HOST}/web/namespaces/demo/manage/load_balancers/http_loadbalancers`;

		// 1. Start the bridge server (xcsh side of the native-messaging pipeline).
		server = await startBridgeServer();

		// 2. Launch Chrome with the extension loaded via Puppeteer 24.x API. Map the
		//    console host onto the local fixture and accept its self-signed cert.
		const puppeteer = (await import("puppeteer")).default;
		browser = await puppeteer.launch({
			headless: false,
			pipe: true, // required for enableExtensions with path list
			enableExtensions: [EXT_PATH],
			acceptInsecureCerts: true,
			args: [`--host-resolver-rules=MAP ${CONSOLE_HOST} 127.0.0.1:${fx.port}`, "--ignore-certificate-errors"],
		});

		// 3. Wait for the extension's service worker to start — and to be evaluable,
		//    not merely present. See acquireLiveWorker.
		worker = await acquireLiveWorker(20_000);

		// 4. Wait for the bridge connection (SW → native host → xcsh socket).
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline && !server.connected) {
			await sleep(500);
		}

		// 5. Bind the bridge session to a real Chrome tab. The extension enforces a
		//    per-tab session model: a tool_request from a port that isn't correlated
		//    to an open tab is refused ("no bound tab for this session"). The port
		//    correlates when our hello_ack / tenant_changed advertises
		//    `sessionId = tab-<chromeTabId>` for an OPEN tab (see
		//    xcsh-chrome-extension service-worker.ts:correlatePortToTab). So: learn
		//    a real tab id from the SW, advertise it, push a tenant_changed to force
		//    re-correlation, then wait until a ping actually round-trips.
		const tabId = await currentTabId();
		if (tabId == null) throw new Error("E2E: no Chrome tab available to bind the bridge session");
		await bindToTab(tabId);
	}, 60_000);

	afterAll(async () => {
		await browser?.close().catch(() => {});
		await server?.close().catch(() => {});
		fixtureServer?.stop();
		if (certDir) fs.rmSync(certDir, { recursive: true, force: true });
	}, 15_000);

	// --- Helpers ---

	/**
	 * Acquire a service-worker handle that can actually be evaluated in.
	 *
	 * `browser.waitForTarget()` resolves IMMEDIATELY when a matching target
	 * already exists — and after `worker.close()` the terminated service-worker
	 * target lingers in the target list while detached. So waiting on target
	 * presence hands back the dead handle, and the first `evaluate()` throws
	 * "Execution context is not available in detached frame or worker" (#2417).
	 *
	 * Target presence is the wrong signal. The property we actually depend on is
	 * a live execution context, so probe for exactly that: re-resolve the target
	 * and attempt a trivial evaluate, retrying until one succeeds. This is a
	 * correctness wait, not a latency tweak — a longer sleep cannot fix it,
	 * because the stale handle never becomes usable no matter how long we wait.
	 */
	async function acquireLiveWorker(timeoutMs = 30_000): Promise<WebWorker> {
		const deadline = Date.now() + timeoutMs;
		let lastError: unknown;
		while (Date.now() < deadline) {
			try {
				const target = await browser.waitForTarget(
					t => t.type() === "service_worker" && t.url().includes("service-worker"),
					{ timeout: Math.max(1_000, deadline - Date.now()) },
				);
				const candidate = await target.worker();
				if (candidate) {
					// The probe IS the readiness check: a detached worker throws here.
					await candidate.evaluate(() => true);
					return candidate;
				}
			} catch (error) {
				lastError = error;
			}
			await sleep(250);
		}
		throw new Error(`no evaluable service worker within ${timeoutMs}ms; last error: ${String(lastError)}`);
	}

	// Pick a tab id to bind to. Prefer a real http(s) tab (the console the tools
	// operate on); fall back to the last tab that exists.
	async function currentTabId(): Promise<number | null> {
		return await worker!.evaluate(async () => {
			const tabs = await chrome.tabs.query({});
			const withId = tabs.filter(t => typeof t.id === "number" && t.id >= 0);
			const httpTab = withId.find(t => (t.url ?? "").startsWith("http"));
			return (httpTab ?? withId[withId.length - 1])?.id ?? null;
		});
	}

	// Advertise `sessionId = tab-<id>` and push a tenant_changed so the extension
	// correlates this bridge port to that tab, then wait until a ping round-trips.
	async function bindToTab(tabId: number): Promise<boolean> {
		boundTabId = tabId;
		server.setSessionInfo(() => ({
			tenant: "demo",
			env: "staging",
			apiUrl: null,
			contextBound: false,
			sessionId: `tab-${tabId}`,
		}));
		server.broadcastTenantChanged();
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline) {
			const r = await server.request("ping", {}, 4_000).catch(() => null);
			if (r && !r.is_error) return true;
			await sleep(250);
		}
		return false;
	}

	// Re-assert the binding after the extension re-tenants a tab (loading a tenant
	// URL clears the manual correlation, since the extension owns tenant-tab
	// provisioning). The test plays the role of the session manager here.
	async function ensureBound(): Promise<void> {
		const id = (await currentTabId()) ?? boundTabId;
		if (id != null) await bindToTab(id);
	}

	async function tool(name: string, params: Record<string, unknown> = {}, timeout = 30_000) {
		let r = await server.request(name, params, timeout);
		if (r.is_error && String(r.content).includes("no bound tab")) {
			// The extension dropped our correlation (tab re-tenanted); rebind + retry.
			await ensureBound();
			r = await server.request(name, params, timeout);
		}
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
				// Accept a clear size error OR the extension's deliberate "screenshot
				// deferred / not supported" response — both are clear, non-silent
				// failures, which is what this test guards against.
				if (/too large|size|900|not supported|deferred|captureVisibleTab/i.test(msg)) gotSizeError = true;
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

			// Re-acquire the worker handle FIRST — the old one is detached after
			// close(), and ensureBound() calls worker.evaluate() to read the tab id.
			// Must wait for an *evaluable* worker, not merely a present target: the
			// terminated target lingers detached and would be returned instantly.
			worker = await acquireLiveWorker();

			// The reconnected port is a fresh socket with no tab correlation; re-assert
			// the binding (as the session manager would) before pinging.
			await ensureBound();

			// Ping after recovery.
			const pong = await tool("ping", {}, 10_000);
			expect(pong).toMatchObject({ ok: true });
		}, 90_000);
	});
}); // describe.skipIf(isCI) — Extension E2E
