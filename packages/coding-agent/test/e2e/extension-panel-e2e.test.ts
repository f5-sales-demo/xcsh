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
 *   XCSH_STAGING_API_URL=https://nferreira.staging.volterra.us \
 *   XCSH_STAGING_API_TOKEN=<token> \
 *   XCSH_STAGING_USERNAME=r.mordasiewicz@f5.com \
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
	turnFailed,
	waitForPanelReady,
	waitForTurnDone,
} from "./harness/panel-harness";

const API_URL = process.env.XCSH_STAGING_API_URL;
const API_TOKEN = process.env.XCSH_STAGING_API_TOKEN;
const USERNAME = process.env.XCSH_STAGING_USERNAME;
const PASSWORD = process.env.XCSH_STAGING_PASSWORD;
const NS = process.env.XCSH_STAGING_NAMESPACE ?? "r-mordasiewicz";
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
	}, 600_000);

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

		const { status } = await api("GET", resourcePath(NS, "healthchecks", NAMES.smokeHc));
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

		const hc = await api("GET", resourcePath(NS, "healthchecks", NAMES.hc));
		const pool = await api("GET", resourcePath(NS, "origin_pools", NAMES.pool));
		const lb = await api("GET", resourcePath(NS, "http_loadbalancers", NAMES.lb));
		if (hc.status !== 200 || pool.status !== 200 || lb.status !== 200) {
			console.log("multi reply:", await readLastReply(panel));
		}
		expect(hc.status).toBe(200);
		expect(pool.status).toBe(200);
		expect(lb.status).toBe(200);
	}, 700_000);
});
