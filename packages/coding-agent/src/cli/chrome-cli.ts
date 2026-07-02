/**
 * Chrome CLI command handlers.
 *
 * Backs both `xcsh chrome [status|relaunch|setup]` and the `/chrome` REPL slash
 * command. `renderStatus` is a pure formatter so it can be unit-tested without
 * touching Chrome, settings, or the network.
 */

import { acquirePage, type BrowserProviderStatus, CdpBrowserProvider } from "../browser";
import { PORT_RANGE_END, PORT_RANGE_START, resolveForcedPort } from "../browser/extension-bridge";

type Settings = { get(key: string): unknown };

export type ChromeAction = "status" | "relaunch" | "setup";

export const EXTENSION_ID = "klajkjdoehjidngligegnpknogmjjhkc";

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
		// host manifest to install. A forced port is reported exactly; otherwise xcsh
		// auto-selects the lowest free port in the discovery range at launch.
		const forced = resolveForcedPort();
		const where =
			forced !== null
				? `ws://127.0.0.1:${forced} (forced via XCSH_BRIDGE_PORT)`
				: `the lowest free port in ${PORT_RANGE_START}-${PORT_RANGE_END} (printed in the xcsh startup banner)`;
		return (
			`The xcsh Chrome extension connects directly to xcsh over a loopback WebSocket on ${where}.\n` +
			`The extension scans that range and links each tenant's xcsh automatically.\n` +
			`Install/keep the xcsh Chrome extension from the Web Store:\n  ${WEB_STORE_URL}`
		);
	}
	// relaunch: self-consented rung 3 — force allowRelaunch regardless of the setting.
	const { mode } = await acquirePage({ settings, allowRelaunch: true });
	return `Chrome ready (${mode}). Your real, logged-in session is now debuggable for xcsh.`;
}
