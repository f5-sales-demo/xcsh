/**
 * Panel-driven E2E harness for the xcsh Chrome extension.
 *
 * Drives the extension's real NATIVE side panel to exercise the ENTIRE chain:
 *
 *   side panel → SW → native-host bridge → worker → LLM → tool_request
 *     → SW dispatches via CDP → Chrome console forms → F5 XC API
 *
 * This is the piece a WS-bridge-to-the-worker approach cannot exercise: only the
 * extension's service worker owns the `chrome.debugger` CDP connection that the
 * browser-automation tool needs to fill console forms.
 *
 * ── Model: connect(), NOT launch() ──────────────────────────────────────────
 * A Chrome that Puppeteer *launches* cannot do native-messaging worker
 * provisioning (proven exhaustively): the extension's `connectNative` fails
 * "host not found", no chrome-host spawns, no worker is adopted, and the panel
 * hangs at "starting worker… / xcsh didn't start". Instead we:
 *   1. Mirror the installed xcsh native-host manifest into the launch profile's
 *      `NativeMessagingHosts/` dir — a Chrome with a custom `--user-data-dir`
 *      searches THERE, not the global install dir (this was the root-cause bug).
 *   2. Start Chrome as a normal OS process (no automation flags) with the
 *      extension + remote debugging, then `puppeteer.connect()` to it.
 *   3. Let the operator open the NATIVE side panel via the toolbar (one click;
 *      Puppeteer can't trigger it). Once open it is a normal `page` target we
 *      drive — type prompts, read the transcript. The worker's automation drives
 *      the console tab independently, so we do NOT attach Puppeteer to that tab.
 *
 * Runtime (`puppeteer`) is imported dynamically inside `launchAndConnect` so this
 * module — and its pure helpers — load in CI without pulling in a browser.
 * Never `process.exit()` from a test module (issue #1903); gate with skipIf.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Browser, Page } from "puppeteer";
import { CONSOLE_SHELL_SELECTOR, LOGIN_SELECTOR, triggerSavedPasswordExpr } from "../../../src/browser/auth";

// ── Constants ───────────────────────────────────────────────────────────────

/** Extension unpacked-dist directory. Override with XCSH_EXT_DIST; defaults to
 * the sibling `xcsh-chrome-extension/dist` checkout. */
export const EXT_DIST =
	process.env.XCSH_EXT_DIST ?? resolve(import.meta.dir, "../../../../../../xcsh-chrome-extension/dist");

/** The fixed dev-build extension id (from the injected `key`; see inject-key.mjs).
 * This is the id the xcsh native-messaging host allow-lists, so the bridge works. */
export const EXT_ID = "klajkjdoehjidngligegnpknogmjjhkc";

/** The panel page URL inside the loaded extension. */
export const PANEL_URL = `chrome-extension://${EXT_ID}/side-panel.html`;

/** Default staging console landing URL (WAAP → load balancers). */
export const DEFAULT_CONSOLE_URL =
	"https://example.staging.volterra.us/web/workspaces/web-app-and-api-protection/namespaces/system/manage/load_balancers/http_loadbalancers";

// ── Pure helpers (unit-tested in panel-harness.test.ts) ──────────────────────

/** Minimal structural Document (matches both the browser and a test fake). */
export interface QueryableDoc {
	querySelector(sel: string): unknown;
}

/**
 * A chat turn is terminal exactly when the composer shows the idle SEND button
 * and no longer the streaming STOP button. This mirrors the panel's own
 * `active !== null` state (Composer.tsx swaps #send↔#stop). It fires on ALL
 * terminal states — done, error, user-stop, timeout-abort — which is what
 * "the turn is no longer running" should mean. Require send-present AND
 * stop-absent so a mid-swap frame never reads as done.
 */
export function isTurnDoneDom(doc: QueryableDoc): boolean {
	return doc.querySelector("#send") != null && doc.querySelector("#stop") == null;
}

export interface ResourceNames {
	smokeHc: string;
	hc: string;
	pool: string;
	lb: string;
	waf: string;
}

/** Deterministic, run-scoped resource names. Same suffix → identical names, so a
 * rerun reuses (and cleans up) the same objects rather than leaking new ones. */
export function resourceNames(suffix: string): ResourceNames {
	return {
		smokeHc: `e2e-smoke-hc-${suffix}`,
		hc: `e2e-hc-${suffix}`,
		pool: `e2e-pool-${suffix}`,
		lb: `e2e-lb-${suffix}`,
		waf: `e2e-waf-${suffix}`,
	};
}

export interface CleanupEntry {
	resource: string;
	name: string;
}

/**
 * Deletion order honouring the F5 XC reference chain: an HTTP load balancer
 * references its origin pool and app firewall; an origin pool references its
 * health check. Delete top-down so no delete is refused for a live reference:
 * load balancer → app firewall → origin pool → health checks.
 */
export function cleanupOrder(names: ResourceNames): CleanupEntry[] {
	return [
		{ resource: "http_loadbalancers", name: names.lb },
		{ resource: "app_firewalls", name: names.waf },
		{ resource: "origin_pools", name: names.pool },
		{ resource: "healthchecks", name: names.hc },
		{ resource: "healthchecks", name: names.smokeHc },
	];
}

/** F5 XC config API path (mirrors staging-crud.test.ts). */
export function resourcePath(ns: string, resource: string, name?: string): string {
	const base = `/api/config/namespaces/${ns}/${resource}`;
	return name ? `${base}/${name}` : base;
}

/** The live-run gate: all four staging vars present and not running in CI. */
export function canRunLive(env: Record<string, string | undefined>): boolean {
	const isCI = !!env.CI || !!env.GITHUB_ACTIONS;
	return (
		!isCI &&
		!!env.XCSH_STAGING_API_URL &&
		!!env.XCSH_STAGING_API_TOKEN &&
		!!env.XCSH_STAGING_USERNAME &&
		!!env.XCSH_STAGING_PASSWORD
	);
}

// ── Browser-driving functions (exercised only in the gated live E2E) ─────────
//
// DESIGN: connect(), do NOT launch(). Root cause proven the hard way — a Chrome
// that Puppeteer *launches* (or one started with `--user-data-dir` whose profile
// lacks the native-host manifest) cannot do native-messaging worker provisioning:
// the extension's `connectNative` fails "host not found", no chrome-host spawns,
// no worker is adopted → the panel hangs at "starting worker… / xcsh didn't start".
// The fixes, all necessary:
//   1. A Chrome with a custom `--user-data-dir` searches `<user-data-dir>/
//      NativeMessagingHosts/` for host manifests (NOT the global install dir), so
//      we mirror the installed xcsh host manifest into the profile.
//   2. Launch Chrome as a NORMAL process (not puppeteer.launch → no automation
//      flags), with the extension loaded, so provisioning behaves as for a human.
//   3. The xcsh side panel is Chrome's NATIVE side panel (opened via the toolbar);
//      once open it is a normal `page` target we drive over `connect()`.

const CHROME_CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
];

function resolveChromeBinary(): string {
	const override = process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROME_BIN;
	if (override) return override;
	const found = CHROME_CANDIDATES.find(p => existsSync(p));
	if (!found) throw new Error("No Chrome binary found; set CHROME_BIN to your Google Chrome executable.");
	return found;
}

/**
 * Mirror the installed xcsh native-messaging host manifest(s) into the launch
 * profile's `NativeMessagingHosts/` dir. A Chrome started with `--user-data-dir`
 * searches there — NOT the global `~/Library/Application Support/Google/Chrome/…`
 * dir — so without this the extension's `connectNative` fails "host not found"
 * and no worker can ever be provisioned. Idempotent; the manifest's `path` to the
 * host wrapper is absolute, so only the `.json` needs copying. macOS + Linux.
 */
export function ensureNativeHostInProfile(userDataDir: string): number {
	const home = homedir();
	const srcDir =
		process.platform === "darwin"
			? join(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts")
			: join(home, ".config/google-chrome/NativeMessagingHosts");
	if (!existsSync(srcDir)) return 0;
	const dstDir = join(userDataDir, "NativeMessagingHosts");
	mkdirSync(dstDir, { recursive: true });
	let n = 0;
	for (const f of readdirSync(srcDir)) {
		if (f.includes("xcsh") && f.endsWith(".json")) {
			copyFileSync(join(srcDir, f), join(dstDir, f));
			n++;
		}
	}
	return n;
}

export interface ChromeSession {
	browser: Browser;
	proc: ChildProcess;
	port: number;
}

/**
 * Start a real Chrome as a normal OS process (NOT puppeteer.launch) with the
 * unpacked extension + remote debugging, then `puppeteer.connect()` to it. Ensures
 * the native-host manifest is in the profile first. `protocolTimeout` is raised
 * because a resource-creating turn drives the console for minutes and Puppeteer's
 * 180s default would abort our waits mid-turn.
 */
export async function launchAndConnect(
	userDataDir: string,
	opts: { consoleUrl?: string; port?: number; extDist?: string } = {},
): Promise<ChromeSession> {
	const port = opts.port ?? 9222;
	const extDist = opts.extDist ?? EXT_DIST;
	const puppeteer = (await import("puppeteer")).default;
	const browserURL = `http://127.0.0.1:${port}`;

	// If a Chrome is ALREADY on this port (operator pre-launched it — the most robust
	// path, no spawn race), connect to it. This is the proven flow: the operator runs
	// the launcher, logs in, opens the panel; we just connect + drive.
	let browser = await puppeteer
		.connect({ browserURL, protocolTimeout: 900_000, defaultViewport: null })
		.catch(() => undefined);
	let proc: ChildProcess;
	if (browser) {
		proc = spawn("true", [], { stdio: "ignore" }); // placeholder; we did not launch Chrome
	} else {
		ensureNativeHostInProfile(userDataDir);
		mkdirSync(userDataDir, { recursive: true });
		const args = [
			`--remote-debugging-port=${port}`,
			`--user-data-dir=${userDataDir}`,
			`--load-extension=${extDist}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--window-size=1600,1200",
		];
		if (opts.consoleUrl) args.push(opts.consoleUrl);
		proc = spawn(resolveChromeBinary(), args, { detached: false, stdio: "ignore" });
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			browser = await puppeteer
				.connect({ browserURL, protocolTimeout: 900_000, defaultViewport: null })
				.catch(() => undefined);
			if (browser) break;
			await Bun.sleep(500);
		}
		if (!browser) {
			proc.kill();
			throw new Error(`Could not connect to Chrome at ${browserURL} within 30s`);
		}
	}
	// A reused profile restores its saved window bounds, ignoring `--window-size`,
	// which can leave the console cramped (truncated columns, hidden controls).
	// Force a large window via CDP, which overrides the restored bounds.
	await maximizeWindow(browser).catch(() => {});
	return { browser, proc, port };
}

/** Force the Chrome window large via CDP (overrides a reused profile's saved bounds). */
async function maximizeWindow(browser: Browser): Promise<void> {
	const pages = await browser.pages();
	const pg = pages[0];
	if (!pg) return;
	const s = await pg.createCDPSession();
	try {
		const { windowId } = (await s.send("Browser.getWindowForTarget")) as { windowId: number };
		await s.send("Browser.setWindowBounds", { windowId, bounds: { width: 1600, height: 1200, left: 0, top: 0 } });
	} finally {
		await s.detach().catch(() => {});
	}
}

/**
 * Pipe the extension service-worker + all page consoles to a log file. Diagnostic
 * only — reveals SW-side activation/provision behaviour (why a worker never gets
 * requested under Chrome-for-Testing). Attaches to the current SW target and to
 * any target opened afterwards.
 */
export async function attachDiagnostics(browser: Browser, logPath: string): Promise<void> {
	const write = (tag: string, text: string) => {
		try {
			appendFileSync(logPath, `[${tag}] ${text}\n`);
		} catch {
			// diagnostics only
		}
	};
	const wireWorker = async (target: { type(): string; url(): string; worker(): Promise<unknown> }) => {
		if (target.type() !== "service_worker") return;
		const w = (await target.worker().catch(() => null)) as {
			on?: (e: string, cb: (m: { text(): string }) => void) => void;
		} | null;
		w?.on?.("console", m => write("SW", m.text()));
	};
	const wirePage = async (target: { type(): string; page(): Promise<unknown> }) => {
		if (target.type() !== "page") return;
		const p = (await target.page().catch(() => null)) as {
			on?: (e: string, cb: (m: { text(): string }) => void) => void;
		} | null;
		p?.on?.("console", m => write("PAGE", m.text()));
	};
	for (const t of browser.targets()) {
		await wireWorker(t as never);
		await wirePage(t as never);
	}
	browser.on("targetcreated", t => {
		void wireWorker(t as never);
		void wirePage(t as never);
	});
}

/** Login navigates through Keycloak redirects; a page.evaluate that races a
 * navigation throws "Execution context was destroyed". Retry a few times so a
 * mid-redirect poll simply waits for the next context instead of failing. */
async function retryOnNav<T>(fn: () => Promise<T>, fallback: T, tries = 6): Promise<T> {
	for (let i = 0; i < tries; i++) {
		try {
			return await fn();
		} catch (e) {
			if (!/context was destroyed|Cannot find context|navigated|detached/i.test(String(e))) throw e;
			await Bun.sleep(400);
		}
	}
	return fallback;
}

async function evalAuthState(page: Page): Promise<{ loginWall: boolean; authed: boolean }> {
	return retryOnNav(
		() =>
			page.evaluate(
				(loginSel, shellSel) => {
					const doc = (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document;
					const loginWall = doc.querySelector(loginSel) != null;
					const authed = doc.querySelector(shellSel) != null && !loginWall;
					return { loginWall, authed };
				},
				LOGIN_SELECTOR,
				CONSOLE_SHELL_SELECTOR,
			),
		{ loginWall: false, authed: false },
	);
}

async function clickSubmit(page: Page): Promise<void> {
	await retryOnNav(
		() =>
			page.evaluate(() => {
				const doc = (globalThis as unknown as { document: { querySelector(s: string): { click(): void } | null } })
					.document;
				const btn = doc.querySelector("#kc-login, button[type='submit'], input[type='submit']");
				btn?.click();
				return true;
			}),
		false,
	);
}

export interface LoginOptions {
	consoleUrl: string;
	username: string;
	password: string;
	/** Total time to wait for authentication (auto + operator co-drive). Default 5 min. */
	timeoutMs?: number;
	onLoginRequired?: () => void;
}

/**
 * Open the console and ensure it is authenticated. Reuses a persisted session
 * when present; otherwise types the Keycloak credentials (handling both a
 * single-page and a two-step email→password wall) and submits, then polls until
 * the authenticated console shell appears — with an operator co-drive fallback
 * for any MFA/interstitial that automation can't clear.
 */
export async function openConsoleAndLogin(browser: Browser, opts: LoginOptions): Promise<Page> {
	const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
	// Reuse the console tab Chrome opened with the launch URL; otherwise open one.
	const pages = await browser.pages();
	let page = pages.find(p => /\.volterra\.us\//.test(p.url()) || /\.console\.ves\.volterra\.io\//.test(p.url()));
	if (!page) {
		page = await browser.newPage();
		await page.goto(opts.consoleUrl, { waitUntil: "domcontentloaded" });
	}

	// Settle on EITHER the login wall or the console shell before doing anything —
	// the console→Keycloak redirect chain fires client-side navigations after
	// `goto` resolves. `waitForFunction` re-binds to each new context, so it rides
	// the redirects out instead of racing them.
	await page
		.waitForFunction(
			(loginSel, shellSel) => {
				const d = (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document;
				return d.querySelector(loginSel) != null || d.querySelector(shellSel) != null;
			},
			{ polling: 500, timeout: 60_000 },
			LOGIN_SELECTOR,
			CONSOLE_SHELL_SELECTOR,
		)
		.catch(() => {});

	if ((await evalAuthState(page)).authed) return page;

	// Best-effort automated form-fill (once). Failures fall through to co-drive.
	try {
		const userSel = "#username, input[name='username']";
		if (await page.$(userSel)) {
			const u = await page.$(userSel);
			await u?.click({ count: 3 });
			await u?.type(opts.username, { delay: 15 });
		}
		let pw = await page.$("#password, input[type='password']");
		if (!pw) {
			// Two-step wall: submit the username to reveal the password field.
			await clickSubmit(page);
			await page.waitForSelector("#password, input[type='password']", { timeout: 15_000 }).catch(() => {});
			pw = await page.$("#password, input[type='password']");
		}
		if (pw) {
			await pw.click({ count: 3 });
			await pw.type(opts.password, { delay: 15 });
		}
		await clickSubmit(page);
	} catch {
		// ignore — the co-drive poll below handles a stuck/variant wall.
	}

	let announced = false;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { loginWall, authed } = await evalAuthState(page);
		if (authed) return page;
		if (loginWall && !announced) {
			opts.onLoginRequired?.();
			announced = true;
			// Nudge Chrome's saved-password manager once, then keep polling.
			await page.evaluate(triggerSavedPasswordExpr()).catch(() => {});
		}
		await Bun.sleep(1000);
	}
	throw new Error(`Timed out after ${timeoutMs}ms waiting for authentication at ${opts.consoleUrl}`);
}

/**
 * Open the side panel as a background tab and bind it to the console tab.
 *
 * The panel binds `boundTabId` to whatever `chrome.tabs.onActivated` reports, so
 * we toggle activation (panel tab → console tab) until the composer's SEND
 * button becomes enabled — meaning the bridge, worker, and page gates all passed
 * for the console tab. We leave the CONSOLE tab active on return so the binding
 * holds; the panel tab is never foregrounded again.
 */
/** Read the panel's activation state for diagnostics (which gate is stuck). */
export async function panelDiagnostics(panel: Page): Promise<string> {
	return panel
		.evaluate(() => {
			const d = (
				globalThis as unknown as {
					document: {
						querySelector(s: string): { innerText?: string; placeholder?: string; disabled?: boolean } | null;
					};
				}
			).document;
			const input = d.querySelector("#input");
			const root = d.querySelector("#root");
			return JSON.stringify({
				placeholder: input?.placeholder ?? "(no #input)",
				sendPresent: d.querySelector("#send") != null,
				sendDisabled: d.querySelector("#send")?.disabled ?? null,
				stopPresent: d.querySelector("#stop") != null,
				text: root?.innerText?.replace(/\s+/g, " ").slice(0, 400) ?? "",
			});
		})
		.catch(e => `(diagnostics failed: ${String(e)})`);
}

/**
 * Find the NATIVE side panel's page target. The panel is opened via the Chrome
 * toolbar action (which Puppeteer cannot trigger on a connected browser), so if it
 * is not open yet we invoke `onOpenRequired` and poll until the operator clicks the
 * xcsh toolbar icon. Once open, `side-panel.html` is a normal `page` target.
 */
export async function findPanel(
	browser: Browser,
	opts: { timeoutMs?: number; onOpenRequired?: () => void } = {},
): Promise<Page> {
	const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
	const isPanel = (x: { type(): string; url(): string }) => x.type() === "page" && x.url().includes("side-panel.html");
	// Already open?
	let target = browser.targets().find(isPanel);
	if (!target) {
		opts.onOpenRequired?.();
		// waitForTarget is event-based, so it catches the panel target the moment it
		// appears after the operator opens the panel (a snapshot poll can miss it).
		target = await browser.waitForTarget(isPanel, { timeout: timeoutMs }).catch(() => undefined);
	}
	if (!target) {
		throw new Error(`Side panel never opened within ${timeoutMs}ms (click the xcsh toolbar icon to open it).`);
	}
	// Resolve a Page handle for the panel target. A NATIVE Chrome side panel is a
	// `page`-type target Puppeteer does NOT auto-attach to, so `browser.pages()` (only
	// attached pages) never lists it and `target.page()` stays null — `target.asPage()`
	// forces attachment. Re-resolve the target each iteration because the panel reloads
	// during provisioning, which invalidates an earlier handle. ~30s window.
	let pg: Page | null = null;
	for (let i = 0; i < 60 && !pg; i++) {
		const t = browser.targets().find(isPanel) ?? target;
		const pages = await browser.pages().catch(() => [] as Page[]);
		pg =
			pages.find(p => p.url().includes("side-panel.html")) ??
			(await t.page().catch(() => null)) ??
			(await (typeof t.asPage === "function" ? t.asPage() : Promise.resolve(null)).catch(() => null));
		if (!pg) await Bun.sleep(500);
	}
	if (!pg) throw new Error("Side panel target found but no Page handle appeared.");
	await pg.waitForSelector("#input", { timeout: 30_000 }).catch(() => {});
	return pg;
}

/**
 * Wait for the panel to reach ready (composer SEND enabled). If activation stalls
 * on the overlay ("xcsh didn't start"), click its Retry — a fresh provision attempt
 * (now that the native-host manifest is in the profile) reliably brings a worker up.
 */
export async function waitForPanelReady(panel: Page, readyTimeoutMs = 240_000): Promise<Page> {
	// A reused session may still be streaming a prior turn (#stop present); abort it
	// so the panel can go idle, otherwise SEND never re-enables. (Each scenario really
	// wants a fresh browser session, but this keeps a reused one from wedging.)
	if (await panel.$("#stop")) {
		await panel.click("#stop").catch(() => {});
		await Bun.sleep(1500);
	}
	const start = Date.now();
	let nextRetryAt = 45_000;
	while (Date.now() - start < readyTimeoutMs) {
		if (await panel.$("#send:not([disabled])")) return panel;
		if (Date.now() - start >= nextRetryAt) {
			// Click the activation-overlay "Retry" button (by visible text) to re-provision.
			await panel
				.evaluate(() => {
					type El = { textContent?: string | null; offsetParent?: unknown; click(): void };
					const d = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<El> } })
						.document;
					const els = Array.from(d.querySelectorAll("button, [role=button], a, span, div"));
					const r = els.find(e => e.textContent?.trim() === "Retry" && e.offsetParent !== null);
					r?.click();
				})
				.catch(() => {});
			nextRetryAt += 45_000;
		}
		await Bun.sleep(2000);
	}
	throw new Error(`Panel never reached ready (send enabled). Activation state: ${await panelDiagnostics(panel)}`);
}

/**
 * Set the panel's response mode. Default `configuration` = "Config building", the
 * EXECUTION mode that drives the console to create resources. `educational` (the
 * panel default) only EXPLAINS and creates nothing, so the harness must switch.
 */
export async function setMode(panel: Page, mode = "configuration"): Promise<void> {
	await panel.select("select.modeBtn", mode).catch(() => {});
}

/**
 * Start a FRESH conversation. The panel has no new-chat control and keys its
 * conversation to the tab (persisted in `chrome.storage.local`), so reusing the
 * panel across turns accumulates prior turns — which disrupts a later multi-step
 * turn (the model starts meta-commenting on "the last run" instead of executing).
 * Clear the stored conversations and reload the panel. Returns the panel page
 * (re-acquired after reload); the caller should re-run waitForPanelReady + setMode.
 */
export async function resetConversation(browser: Browser): Promise<Page> {
	const swT = await browser
		.waitForTarget(t => t.type() === "service_worker" && t.url().includes("service-worker"), { timeout: 15_000 })
		.catch(() => null);
	if (swT) {
		const sw = (await swT.worker().catch(() => null)) as { evaluate?: (f: () => unknown) => Promise<unknown> } | null;
		await sw
			?.evaluate?.(() =>
				(
					globalThis as unknown as { chrome: { storage: { local: { clear(): void } } } }
				).chrome.storage.local.clear(),
			)
			.catch(() => {});
	}
	const panel = (await browser.pages()).find(p => p.url().includes("side-panel.html"));
	if (panel) await panel.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
	const pg = (await browser.pages()).find(p => p.url().includes("side-panel.html"));
	if (!pg) throw new Error("Side panel page gone after conversation reset.");
	await pg.waitForSelector("#input", { timeout: 30_000 }).catch(() => {});
	return pg;
}

/** Type a prompt into the panel and send it, then wait for the turn to REALLY
 * start (the streaming STOP button). After a cold start / conversation reset the
 * panel may first flash a transient "xcsh is starting for this tab — one moment,
 * then resend." error; it self-heals and AUTO-RESENDS, so we keep waiting for #stop
 * through it and only bail on a NON-transient error. Does not foreground the panel. */
export async function sendPrompt(panel: Page, text: string): Promise<void> {
	await panel.type("#input", text);
	await panel.click("#send");
	await awaitTurnStart(panel);
}

/**
 * Wait for the turn to REALLY start — the streaming STOP button — riding through the
 * transient "starting… / resend" self-heal (which auto-resends), bailing only on a
 * NON-transient error. Split out of sendPrompt so a caller that needs to measure
 * time-to-first-token can time just the send→start window (excluding the type() cost).
 */
export async function awaitTurnStart(panel: Page, timeoutMs = 120_000): Promise<void> {
	await panel.waitForFunction(
		() => {
			const d = (
				globalThis as unknown as { document: { querySelector(s: string): { textContent?: string | null } | null } }
			).document;
			if (d.querySelector("#stop")) return true; // turn is streaming — really started
			const err = d.querySelector(".body.error");
			// The "starting… / resend" transient auto-clears + resends; keep waiting.
			// Any OTHER error is terminal, so stop.
			return err != null && !/starting|resend/i.test(err.textContent ?? "");
		},
		{ polling: 300, timeout: timeoutMs },
	);
}

/**
 * Wait for the current turn to reach a terminal state — DEBOUNCED.
 *
 * The naive check ("`#send` present, `#stop` absent") is a single DOM frame, and a
 * MULTI-STEP tool turn briefly shows exactly that idle composer in the gaps between
 * the preamble text and the first tool call, and between tool steps. Returning on the
 * first idle frame false-completes the turn (the benchmark then read `tool_count=0`
 * and verified the API before the tools had run). So require the idle state to hold
 * CONTINUOUSLY for `settleMs` with NO new `#messages .row` appearing; any streaming
 * frame (`#stop` present) or a freshly-added row resets the settle timer. This rides
 * over the false-idle gaps while still returning promptly once the turn truly ends.
 *
 * Polls with `panel.evaluate` (not `waitForFunction`) so the settle/row-count state
 * lives here rather than in the page. Signature-compatible with the old version.
 */
export async function waitForTurnDone(panel: Page, timeoutMs = 600_000, settleMs = 12_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let settleStart: number | null = null;
	let lastRows = -1;
	while (Date.now() < deadline) {
		const s = await panel
			.evaluate(() => {
				const d = (
					globalThis as unknown as {
						document: { querySelector(x: string): unknown; querySelectorAll(x: string): ArrayLike<unknown> };
					}
				).document;
				return {
					idle: d.querySelector("#send") != null && d.querySelector("#stop") == null,
					rows: d.querySelectorAll("#messages .row").length,
				};
			})
			.catch(() => null);
		if (s) {
			// "Stable" = idle composer AND the message list unchanged since the last poll.
			const stable = s.idle && s.rows === lastRows;
			if (stable) {
				settleStart ??= Date.now();
				if (Date.now() - settleStart >= settleMs) return;
			} else {
				settleStart = null; // streaming, or a new row landed → not terminal yet.
			}
			lastRows = s.rows;
		}
		await Bun.sleep(500);
	}
	throw new Error(`waitForTurnDone: turn did not settle (idle for ${settleMs}ms) within ${timeoutMs}ms`);
}

/** True if the last turn ended in an error (an ErrorMessage is rendered). */
export async function turnFailed(panel: Page): Promise<boolean> {
	return (await panel.$(".body.error")) != null;
}

/** The rendered text of the last assistant message, or null if none. */
export async function readLastReply(panel: Page): Promise<string | null> {
	return panel.$$eval("#messages .g-assistant", els => {
		if (!els.length) return null;
		const gutter = els[els.length - 1] as unknown as {
			parentElement: { querySelector(s: string): { innerText?: string } | null } | null;
		};
		const body = gutter.parentElement?.querySelector(".body");
		return body?.innerText ?? null;
	});
}
