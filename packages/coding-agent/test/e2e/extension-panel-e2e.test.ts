/**
 * Panel-driven E2E — types prompts into the REAL xcsh side panel and verifies
 * the resources the extension creates against the live staging F5 XC API.
 *
 * This is the only test that exercises the full chain end to end:
 *   side panel → SW → native-host bridge → worker → LLM → tool_request
 *     → SW dispatches via CDP → Chrome console forms → F5 XC API
 * A WS-bridge-to-the-worker harness cannot do this — only the extension SW owns
 * the CDP connection the browser-automation tool drives.
 *
 * Runs from a VPN-connected workstation ONLY. Gated on the four staging vars and
 * skipped in CI / when creds are absent. Never `process.exit()` here (issue #1903).
 *
 * Model: connect(), don't launch(). The harness starts a real Chrome as a normal
 * OS process (extension loaded + remote debugging + the xcsh native-host manifest
 * mirrored into the profile), `puppeteer.connect()`s to it, logs in, then waits for
 * the operator to open the NATIVE side panel via the toolbar (one click — Puppeteer
 * cannot trigger it) and drives it. See panel-harness.ts for why launch() fails.
 *
 * Prerequisites:
 *   - Extension built with the dev key: `bun run build:dev` in xcsh-chrome-extension
 *   - Native host installed: `xcsh chrome setup`; `xcsh` on PATH; VPN up
 *   - When the Chrome window opens: click the xcsh toolbar icon to open the panel.
 *
 * Run:
 *   XCSH_STAGING_API_URL=https://example.staging.volterra.us \
 *   XCSH_STAGING_API_TOKEN=<token> \
 *   XCSH_STAGING_USERNAME=dana@example.com \
 *   XCSH_STAGING_PASSWORD=<pw> \
 *   bun test test/e2e/extension-panel-e2e.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Page } from "puppeteer";
import {
	attachDiagnostics,
	type ChromeSession,
	canRunLive,
	cleanupOrder,
	findPanel,
	launchAndConnect,
	openConsoleAndLogin,
	readLastReply,
	resourceNames,
	resourcePath,
	sendPrompt,
	setMode,
	turnFailed,
	waitForPanelReady,
	waitForTurnDone,
} from "./harness/panel-harness";

const API_URL = process.env.XCSH_STAGING_API_URL;
const API_TOKEN = process.env.XCSH_STAGING_API_TOKEN;
const USERNAME = process.env.XCSH_STAGING_USERNAME;
const PASSWORD = process.env.XCSH_STAGING_PASSWORD;
const NS = process.env.XCSH_STAGING_NAMESPACE ?? "example-corp";
const canRun = canRunLive(process.env);

// Console lands on the SAME namespace the API verifies against, so the LLM
// creates where we check. Both derive from API_URL + NS (overridable).
const CONSOLE_URL =
	process.env.XCSH_STAGING_CONSOLE_URL ??
	`${API_URL}/web/workspaces/web-app-and-api-protection/namespaces/${NS}/manage/load_balancers/http_loadbalancers`;

// Persistent Chrome profile so a login survives reruns (skip the wall next time).
const PROFILE_DIR = process.env.XCSH_E2E_PROFILE ?? join(tmpdir(), "xcsh-e2e-profile");
const ARTIFACTS = resolve(import.meta.dir, ".artifacts");

const SUFFIX = Date.now().toString(36).slice(-6);
const NAMES = resourceNames(SUFFIX);

const AUTH = { Authorization: `APIToken ${API_TOKEN}` };

async function api(method: string, path: string): Promise<{ status: number; data: unknown }> {
	const res = await fetch(`${API_URL}${path}`, { method, headers: AUTH });
	const data = await res.json().catch(() => null);
	return { status: res.status, data };
}

/** Poll GET until 200 or timeout — a resource appears shortly after the UI reports
 * the turn done (the console automation finishes + F5 XC eventual consistency). */
async function apiGetOk(path: string, timeoutMs = 120_000): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	let status = 0;
	while (Date.now() < deadline) {
		({ status } = await api("GET", path));
		if (status === 200) return status;
		await new Promise(r => setTimeout(r, 5000));
	}
	return status;
}

let session: ChromeSession | undefined;
let panel: Page;

async function snap(page: Page, name: string): Promise<void> {
	try {
		mkdirSync(ARTIFACTS, { recursive: true });
		await page.screenshot({ path: join(ARTIFACTS, `${name}-${SUFFIX}.png`) as `${string}.png` });
	} catch {
		// screenshots are diagnostics only — never fail a test on them.
	}
}

describe.skipIf(!canRun)("Panel-driven E2E (real extension → staging CRUD)", () => {
	beforeAll(async () => {
		mkdirSync(PROFILE_DIR, { recursive: true });
		mkdirSync(ARTIFACTS, { recursive: true });
		session = await launchAndConnect(PROFILE_DIR, { consoleUrl: CONSOLE_URL, port: 9222 });
		await attachDiagnostics(session.browser, join(ARTIFACTS, `sw-console-${SUFFIX}.log`));
		await openConsoleAndLogin(session.browser, {
			consoleUrl: CONSOLE_URL,
			username: USERNAME as string,
			password: PASSWORD as string,
			onLoginRequired: () => console.log("\n⚠️  Log in to staging in the open Chrome window (co-drive)…\n"),
		});
		panel = await findPanel(session.browser, {
			onOpenRequired: () =>
				console.log("\n👉 Click the xcsh toolbar icon in the open Chrome window to open the side panel.\n"),
		});
		await waitForPanelReady(panel);
		await setMode(panel, "configuration"); // execution mode — Educational only explains

		// Warm-up: the FIRST turn on a fresh session aborts at ~30s (first-token
		// timeout / "xcsh is starting… resend") with an empty assistant message. A
		// trivial prompt clears it by warming the worker + LLM pipeline (~9s), so the
		// real test turns run on a warm worker with fast first-token delivery.
		await sendPrompt(panel, "what page is this?");
		await waitForTurnDone(panel, 120_000);
	}, 600_000);

	// NOTE: for a clean multi-step turn, run each scenario against a FRESH browser
	// session (relaunch Chrome + reopen the panel). Reusing one panel accumulates
	// prior turns, which derails a multi-step turn (the model meta-comments on "the
	// last run" instead of executing). `resetConversation()` exists but clearing
	// chrome.storage.local mid-session is disruptive (forces a slow re-provision, can
	// time the next turn out), so we do NOT auto-reset between tests here.

	afterAll(async () => {
		// Leak-proof: delete everything this run created, top-down, ignoring errors.
		if (canRun) {
			for (const { resource, name } of cleanupOrder(NAMES)) {
				await api("DELETE", resourcePath(NS, resource, name)).catch(() => {});
			}
		}
		await session?.browser.disconnect().catch(() => {});
		session?.proc.kill();
	}, 120_000);

	it("smoke: a single health check typed in the panel appears via the API", async () => {
		await sendPrompt(panel, `create a health check named ${NAMES.smokeHc} with an http path of /healthz`);
		await waitForTurnDone(panel, 300_000);
		await snap(panel, "smoke-panel");
		expect(await turnFailed(panel)).toBe(false);

		const status = await apiGetOk(resourcePath(NS, "healthchecks", NAMES.smokeHc));
		if (status !== 200) console.log("smoke reply:", await readLastReply(panel));
		expect(status).toBe(200);
	}, 420_000);

	it("multi-resource: one prompt creates LB + origin pool + health check, all verified via the API", async () => {
		const prompt =
			`create an http load balancer named ${NAMES.lb} ` +
			`with an origin pool named ${NAMES.pool} with a dns member pointing to httpbin.org ` +
			`with a health check named ${NAMES.hc} with an http path of /healthz ` +
			`and apply an app firewall named ${NAMES.waf} on the load balancer`;
		await sendPrompt(panel, prompt);
		await waitForTurnDone(panel, 600_000);
		await snap(panel, "multi-panel");
		if (await turnFailed(panel)) console.log("multi reply:", await readLastReply(panel));

		const hc = await apiGetOk(resourcePath(NS, "healthchecks", NAMES.hc));
		const pool = await apiGetOk(resourcePath(NS, "origin_pools", NAMES.pool));
		const lb = await apiGetOk(resourcePath(NS, "http_loadbalancers", NAMES.lb));
		if (hc !== 200 || pool !== 200 || lb !== 200) console.log("multi reply:", await readLastReply(panel));
		expect(hc).toBe(200);
		expect(pool).toBe(200);
		expect(lb).toBe(200);
	}, 700_000);
});
