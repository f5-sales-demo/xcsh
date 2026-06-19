/**
 * Auth preflight for the F5 XC console.
 *
 * Pure predicates (`isLoginWall` / `isAuthenticated`) classify a document as a
 * login wall or an authenticated console shell. They work over a minimal
 * structural Document so they run both under linkedom in tests and against the
 * live `document` (via page.evaluate) in the browser. `ensureAuthenticated` is
 * the browser-bound orchestrator: on a login wall it triggers saved-password
 * autofill + submit, then falls back to a co-drive poll until the operator logs
 * in. It is verified at a later live gate (no unit test drives a real browser).
 *
 * No Puppeteer imports leak into the pure predicates; only `ensureAuthenticated`
 * references the `Page` type.
 */

import type { Page } from "puppeteer";

/** Minimal structural interface matching both linkedom and browser Document. */
export interface AuthDocument {
	querySelector(sel: string): unknown;
	querySelectorAll(sel: string): ArrayLike<unknown>;
}

/**
 * Selectors that identify a login form. The real XC login wall is a Keycloak
 * page with `#username`, `#password`, and a `#kc-login` submit; the id/name/type
 * alternatives keep this robust across Keycloak theme variations.
 */
export const LOGIN_SELECTOR = "#username, #password, input[name='username'], input[type='password']";

/**
 * Selector that identifies the authenticated console shell. The XC console
 * decorates its chrome with `ves-`-prefixed component classes; the login wall
 * has none (the only `ves-` strings there live in URL query params, not class
 * attributes).
 */
export const CONSOLE_SHELL_SELECTOR = "[class*='ves-']";

/** True when the document presents a login form (Keycloak login wall). */
export function isLoginWall(doc: AuthDocument): boolean {
	return doc.querySelector(LOGIN_SELECTOR) != null;
}

/**
 * True when the document is the authenticated console shell: it carries
 * `ves-`-classed chrome and is NOT showing a login form.
 */
export function isAuthenticated(doc: AuthDocument): boolean {
	return doc.querySelector(CONSOLE_SHELL_SELECTOR) != null && !isLoginWall(doc);
}

/**
 * Source for an injected IIFE that nudges the browser's saved-password manager
 * to autofill the login form and then submits it.
 *
 * It focuses the username/password fields and dispatches synthetic input events
 * so Chrome's credential manager offers its saved entry, then clicks the submit
 * control (`#kc-login`) or, failing that, submits the enclosing form. Returns
 * `true` when a form was found and a submit was attempted.
 *
 * Built as a string (rather than a function reference) so the caller can pass it
 * straight to `page.evaluate`.
 */
export function triggerSavedPasswordExpr(): string {
	return `(() => {
  const username = document.querySelector("#username, input[name='username']");
  const password = document.querySelector("#password, input[type='password']");
  if (!username && !password) return false;
  const nudge = (el) => {
    if (!el) return;
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  nudge(username);
  nudge(password);
  const submit = document.querySelector("#kc-login, button[type='submit'], input[type='submit']");
  if (submit) { submit.click(); return true; }
  const form = (password || username || {}).form;
  if (form && typeof form.requestSubmit === "function") { form.requestSubmit(); return true; }
  if (form && typeof form.submit === "function") { form.submit(); return true; }
  return false;
})()`;
}

export interface EnsureAuthenticatedOptions {
	/** Co-drive poll interval in ms (default 1000). */
	pollIntervalMs?: number;
	/** Total time to wait for the operator to complete login in ms (default 300000 = 5 min). */
	timeoutMs?: number;
	/** Optional callback invoked once when login is required, so callers can surface a co-drive prompt. */
	onLoginRequired?: () => void;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Compute the auth state against the live document inside the page.
 *
 * Self-contained: the selectors are passed as `page.evaluate` ARGS so nothing
 * relies on closure or sibling-function scope (those identifiers do not exist in
 * the page realm). Mirrors the pure `isLoginWall` / `isAuthenticated` predicates,
 * which remain the documented logic over the same two selector consts.
 */
async function evalAuthState(page: Page): Promise<{ loginWall: boolean; authed: boolean }> {
	return page.evaluate(
		(loginSel, shellSel) => {
			const doc = (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document;
			const loginWall = doc.querySelector(loginSel) != null;
			const authed = doc.querySelector(shellSel) != null && !loginWall;
			return { loginWall, authed };
		},
		LOGIN_SELECTOR,
		CONSOLE_SHELL_SELECTOR,
	);
}

/**
 * Ensure the console at `consoleUrl` is authenticated.
 *
 * 1. Navigate to `consoleUrl`.
 * 2. If already authenticated, return immediately.
 * 3. If on a login wall, trigger saved-password autofill + submit once.
 * 4. Poll until authenticated (operator co-drive) or the timeout elapses.
 *
 * Throws if the timeout elapses before authentication succeeds.
 */
export async function ensureAuthenticated(
	page: Page,
	consoleUrl: string,
	opts: EnsureAuthenticatedOptions = {},
): Promise<void> {
	const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	await page.goto(consoleUrl, { waitUntil: "domcontentloaded" });

	{
		const { authed } = await evalAuthState(page);
		if (authed) return;
	}

	let nudged = false;
	let loginAnnounced = false;
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const { loginWall, authed } = await evalAuthState(page);
		if (authed) return;

		if (loginWall) {
			if (!loginAnnounced) {
				opts.onLoginRequired?.();
				loginAnnounced = true;
			}
			if (!nudged) {
				// Try saved-password autofill + submit exactly once; subsequent
				// passes fall through to co-drive polling so we don't fight the
				// operator if autofill failed or no credential was saved.
				await page.evaluate(triggerSavedPasswordExpr());
				nudged = true;
			}
		}

		await sleep(pollIntervalMs);
	}

	throw new Error(
		`Timed out after ${timeoutMs}ms waiting for authentication at ${consoleUrl}; the console is still showing a login wall.`,
	);
}
