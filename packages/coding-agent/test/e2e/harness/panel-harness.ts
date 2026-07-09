/**
 * Panel-driven E2E harness for the xcsh Chrome extension.
 *
 * Launches a real Chrome with the unpacked extension, logs into the F5 XC
 * console, and drives the extension's SIDE PANEL (types a prompt, clicks send,
 * waits for the turn to finish) so the ENTIRE chain engages:
 *
 *   side panel → SW → native-host bridge → worker → LLM → tool_request
 *     → SW dispatches via CDP → Chrome console forms → F5 XC API
 *
 * This is the piece a WS-bridge-to-the-worker approach cannot exercise: only the
 * extension's service worker owns the `chrome.debugger` CDP connection that the
 * browser-automation tool needs to fill console forms.
 *
 * ── Why load the panel as a background tab ──────────────────────────────────
 * Puppeteer cannot open Chrome's NATIVE side panel. The panel is just an
 * extension page (`side-panel.html`), so we open it as a regular tab, then
 * activate the console tab (`consolePage.bringToFront()`). The panel binds its
 * `boundTabId` to whatever tab `chrome.tabs.onActivated` reports — so activating
 * the console tab binds the panel to it. We then NEVER foreground the panel tab
 * again (that would re-gate it to itself and unbind); Puppeteer drives the
 * backgrounded panel's DOM directly, which works regardless of tab visibility.
 * The panel's routing keys chat to `boundTabId` (service-worker.ts onConnect),
 * so a correctly-bound panel routes turns to the console tab's worker.
 *
 * Runtime (`puppeteer`) is imported dynamically inside `launchWithExtension` so
 * this module — and its pure helpers — load in CI without pulling in a browser.
 * Never `process.exit()` from a test module (issue #1903); gate with skipIf.
 */

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
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
	"https://nferreira.staging.volterra.us/web/workspaces/web-app-and-api-protection/namespaces/system/manage/load_balancers/http_loadbalancers";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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

export interface LaunchResult {
	browser: Browser;
}

/**
 * Launch Chrome with the unpacked extension loaded and wait for its MV3 service
 * worker to start. `headless:false` + `pipe:true` are required for
 * `enableExtensions`. A persistent `userDataDir` lets a login survive across
 * reruns. Honors PUPPETEER_EXECUTABLE_PATH / CHROME_BIN for the Chrome binary.
 */
export async function launchWithExtension(userDataDir: string, extDist: string = EXT_DIST): Promise<LaunchResult> {
	const puppeteer = (await import("puppeteer")).default;
	const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROME_BIN;
	const browser = await puppeteer.launch({
		headless: false,
		pipe: true,
		enableExtensions: [extDist],
		userDataDir,
		// `defaultViewport: null` makes each page use the real window size instead
		// of Puppeteer's cramped 800×600 default (which truncates the console and
		// can hide form controls the automation must click). Size the window large.
		defaultViewport: null,
		args: ["--window-size=1600,1200", "--window-position=0,0"],
		...(executablePath ? { executablePath } : {}),
	});
	await browser.waitForTarget(t => t.type() === "service_worker" && t.url().includes("service-worker"), {
		timeout: 30_000,
	});
	return { browser };
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
			await sleep(400);
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
	const page = await browser.newPage();
	await page.goto(opts.consoleUrl, { waitUntil: "domcontentloaded" });

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
			await u?.click({ clickCount: 3 });
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
			await pw.click({ clickCount: 3 });
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
		await sleep(1000);
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
 * Open the side panel and bind it to the console tab. Activating the console tab
 * (after the panel's listeners are attached — guaranteed by #input existing) fires
 * the panel's `onActivated` and binds `boundTabId` to it.
 *
 * Cold-start activation (worker spawn + bridge/worker/page gates) can be slow in a
 * contended environment, so we POLL for the composer's SEND button to enable rather
 * than reset-thrash: a re-bind RESTARTS the gate sequence, so we only re-toggle on a
 * wide interval (~90s) to unstick a genuinely-blocked run without interrupting one
 * that is still progressing. On timeout we surface which gate is stuck.
 */
export async function openPanelBoundTo(browser: Browser, consolePage: Page, readyTimeoutMs = 300_000): Promise<Page> {
	const panel = await browser.newPage();
	await panel.goto(PANEL_URL, { waitUntil: "domcontentloaded" });
	await panel.waitForSelector("#input", { timeout: 30_000 }); // panel mounted → listeners attached

	await consolePage.bringToFront(); // fires panel onActivated(consoleTabId) → bind + start gates

	const start = Date.now();
	let nextRetoggleAt = 90_000;
	while (Date.now() - start < readyTimeoutMs) {
		if (await panel.$("#send:not([disabled])")) return panel;
		if (Date.now() - start >= nextRetoggleAt) {
			await panel.bringToFront().catch(() => {}); // toggle away…
			await sleep(600);
			await consolePage.bringToFront().catch(() => {}); // …and back → fresh onActivated → reprovision
			nextRetoggleAt += 90_000;
		}
		await sleep(2000);
	}
	throw new Error(`Panel never reached ready (send enabled). Activation state: ${await panelDiagnostics(panel)}`);
}

/** Type a prompt into the panel and send it; resolve once the turn has started
 * (stop button shown) or immediately errored. Does NOT foreground the panel. */
export async function sendPrompt(panel: Page, text: string): Promise<void> {
	await panel.type("#input", text);
	await panel.click("#send");
	await panel.waitForFunction(
		() => {
			const doc = (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document;
			return doc.querySelector("#stop") != null || doc.querySelector(".body.error") != null;
		},
		{ polling: 200, timeout: 30_000 },
	);
}

/** Wait for the current turn to reach a terminal state (send↔stop swap back). */
export async function waitForTurnDone(panel: Page, timeoutMs = 600_000): Promise<void> {
	await panel.waitForFunction(
		() => {
			const doc = (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document;
			return doc.querySelector("#send") != null && doc.querySelector("#stop") == null;
		},
		{ polling: 500, timeout: timeoutMs },
	);
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
