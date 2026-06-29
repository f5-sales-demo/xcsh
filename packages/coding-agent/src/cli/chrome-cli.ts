/**
 * Chrome CLI command handlers.
 *
 * Backs both `xcsh chrome [status|relaunch|setup]` and the `/chrome` REPL slash
 * command. `renderStatus` is a pure formatter so it can be unit-tested without
 * touching Chrome, settings, or the network.
 */

import { acquirePage, type BrowserProviderStatus, CdpBrowserProvider } from "../browser";
import { resolvePort } from "../browser/extension-bridge";

type Settings = { get(key: string): unknown };

export type ChromeAction = "status" | "relaunch" | "setup";

// The canonical extension ID (Chrome Web Store + unpacked dev must match).
// If the unpacked extension's ID differs (key.pem mismatch), regenerate key.pem
// from the CWS private key or update this constant to match the dev build.
export const EXTENSION_ID = "khlalklompggpfnmeclpligmcbknkemg";

/**
 * Baked-in Chrome Web Store URL for the xcsh console-automation extension.
 * Surfaced to the user when the extension is not installed/connected so they
 * have a one-click install path instead of a dead end.
 */
export const WEB_STORE_URL = `https://chromewebstore.google.com/detail/${EXTENSION_ID}`;

export function renderStatus(s: BrowserProviderStatus): string {
	const yn = (b: boolean) => (b ? "yes" : "no");
	return [
		"xcsh Chrome status",
		`  Chrome installed:  ${yn(s.chromeInstalled)}`,
		`  Chrome running:    ${yn(s.chromeRunning)}`,
		`  debuggable now:    ${yn(s.debuggableNow)}`,
		`  planned action:    ${s.plannedAction}`,
		`  ${s.detail}`,
		"",
		"  Note: an open Chrome debug port lets any local process drive and read that",
		"  browser (cookies, sessions, saved passwords). xcsh only opens it on loopback,",
		"  for the duration of a task, on a Chrome you attached/launched/relaunched.",
	].join("\n");
}

export async function runChromeCommand(action: ChromeAction, settings: Settings): Promise<string> {
	const provider = new CdpBrowserProvider(settings);
	if (action === "status") return renderStatus(await provider.status());
	if (action === "setup") {
		// The extension connects directly over a loopback WebSocket — no native-messaging
		// host manifest to install. Report the port so the user can point the extension at it.
		const port = resolvePort();
		return (
			`The xcsh Chrome extension connects directly to xcsh over a loopback WebSocket on ` +
			`ws://127.0.0.1:${port} (override with XCSH_BRIDGE_PORT).\n` +
			`Install/keep the xcsh Chrome extension from the Web Store, then it can drive your real Chrome:\n  ${WEB_STORE_URL}`
		);
	}
	// relaunch: self-consented rung 3 — force allowRelaunch regardless of the setting.
	const { mode } = await acquirePage({ settings, allowRelaunch: true });
	return `Chrome ready (${mode}). Your real, logged-in session is now debuggable for xcsh.`;
}
