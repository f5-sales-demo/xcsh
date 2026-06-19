/**
 * Chrome CLI command handlers.
 *
 * Backs both `xcsh chrome [status|relaunch]` and the `/chrome` REPL slash
 * command. `renderStatus` is a pure formatter so it can be unit-tested without
 * touching Chrome, settings, or the network.
 */

import { acquirePage, type BrowserProviderStatus, CdpBrowserProvider } from "../browser";

type Settings = { get(key: string): unknown };

export type ChromeAction = "status" | "relaunch";

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
	// relaunch: self-consented rung 3 — force allowRelaunch regardless of the setting.
	const { mode } = await acquirePage({ settings, allowRelaunch: true });
	return `Chrome ready (${mode}). Your real, logged-in session is now debuggable for xcsh.`;
}
