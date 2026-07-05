/**
 * Chrome CLI command handlers.
 *
 * Backs both `xcsh chrome [status|relaunch|setup]` and the `/chrome` REPL slash
 * command. `renderStatus` is a pure formatter so it can be unit-tested without
 * touching Chrome, settings, or the network.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { acquirePage, type BrowserProviderStatus, CdpBrowserProvider } from "../browser";
import { PORT_RANGE_END, PORT_RANGE_START, resolveForcedPort } from "../browser/extension-bridge";
import { installNativeHost } from "../services/native-host-install";

type Settings = { get(key: string): unknown };

export type ChromeAction = "status" | "relaunch" | "setup" | "install-host";

export const EXTENSION_ID = "klajkjdoehjidngligegnpknogmjjhkc";

/**
 * Baked-in Chrome Web Store URL for the xcsh console-automation extension.
 * Surfaced to the user when the extension is not installed/connected so they
 * have a one-click install path instead of a dead end.
 */
export const WEB_STORE_URL = `https://chromewebstore.google.com/detail/${EXTENSION_ID}`;

/** Find a compiled `xcsh` binary on PATH (self-contained; survives Chrome's stripped env). */
function defaultResolveXcshBin(): string | null {
	const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
	for (const dir of dirs) {
		const candidate = path.join(dir, "xcsh");
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			return candidate;
		} catch {
			/* not on this PATH entry */
		}
	}
	return null;
}

/**
 * Resolve the exec prefix Chrome's launcher wrapper should invoke to reach the
 * `chrome-host` relay (the wrapper appends `chrome-host "$@"`).
 *
 * Compiled: `process.execPath` IS the xcsh binary → ["<xcsh>"].
 * Dev (`bun /abs/src/cli.ts …`): `process.execPath` is bun, which fails under
 * Chrome's stripped env for a `.ts` entry — so prefer a compiled `xcsh` on PATH
 * when resolvable; otherwise fall back to ["<bun>", "<abs entry script>"]. The
 * script is resolved to an ABSOLUTE path because Chrome launches the host from an
 * arbitrary working directory.
 */
export function nativeHostLaunchCommand(
	argv: string[] = process.argv,
	execPath: string = process.execPath,
	resolveXcshBin: () => string | null = defaultResolveXcshBin,
): string[] {
	// Prefer a VERSION-STABLE launcher on PATH (e.g. the Homebrew symlink
	// /opt/homebrew/bin/xcsh) for BOTH compiled and bun installs. This keeps the
	// native-messaging wrapper working across `brew upgrade`s instead of pinning
	// the install-time versioned path (…/Cellar/xcsh/<v>/bin/xcsh), which froze
	// the extension on an old version until install-host was re-run (#1874).
	const xcsh = resolveXcshBin();
	if (xcsh) return [xcsh];
	const base = path.basename(execPath).toLowerCase();
	if (base.startsWith("bun")) {
		const script = argv[1];
		if (script && (script.endsWith(".ts") || script.endsWith(".js") || script.endsWith(".mjs"))) {
			return [execPath, path.resolve(script)];
		}
	}
	return [execPath];
}

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
	if (action === "install-host") {
		// Chrome ignores a manifest `args` field and can't select the `chrome-host`
		// subcommand, so the manifest `path` points at a generated wrapper that execs
		// the resolved xcsh with `chrome-host`. Resolve the launch prefix here (reads
		// process.execPath/argv/PATH); installNativeHost stays a pure writer.
		const launchCommand = nativeHostLaunchCommand();
		const manifestPath = installNativeHost({ launchCommand, extensionIds: [EXTENSION_ID] });
		return `Native-messaging host manifest written to:\n  ${manifestPath}`;
	}
	// relaunch: self-consented rung 3 — force allowRelaunch regardless of the setting.
	const { mode } = await acquirePage({ settings, allowRelaunch: true });
	return `Chrome ready (${mode}). Your real, logged-in session is now debuggable for xcsh.`;
}
