/**
 * Chrome CLI command handlers.
 *
 * Backs both `xcsh chrome [status|relaunch]` and the `/chrome` REPL slash
 * command. `renderStatus` is a pure formatter so it can be unit-tested without
 * touching Chrome, settings, or the network.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { acquirePage, type BrowserProviderStatus, CdpBrowserProvider } from "../browser";

type Settings = { get(key: string): unknown };

export type ChromeAction = "status" | "relaunch" | "setup";

export const EXTENSION_ID = "klajkjdoehjidngligegnpknogmjjhkc";
export const EXTENSION_IDS = [EXTENSION_ID];

const NATIVE_HOST_NAME = "com.f5xc.xcsh.chrome_host";

function nativeHostDir(platform: NodeJS.Platform, home: string): string {
	if (platform === "darwin")
		return path.join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
	return path.join(home, ".config", "google-chrome", "NativeMessagingHosts"); // linux (win32 handled separately — out of slice scope; throw)
}

export function writeNativeHostManifest(opts: {
	platform?: NodeJS.Platform;
	home?: string;
	xcshBinPath: string;
	extensionIds: string[];
	write?: (p: string, c: string) => void;
}): { manifestPath: string } {
	const platform = opts.platform ?? process.platform;
	const home = opts.home ?? os.homedir();
	if (platform === "win32") throw new Error("xcsh chrome setup on Windows is not in the vertical slice");
	const dir = nativeHostDir(platform, home);
	const manifestPath = path.join(dir, `${NATIVE_HOST_NAME}.json`);
	const manifest = {
		name: NATIVE_HOST_NAME,
		description: "xcsh Chrome native-messaging host",
		path: opts.xcshBinPath,
		args: ["chrome-host"],
		type: "stdio",
		allowed_origins: opts.extensionIds.map(id => `chrome-extension://${id}/`),
	};
	const write =
		opts.write ??
		((p, c) => {
			fs.mkdirSync(path.dirname(p), { recursive: true });
			fs.writeFileSync(p, c);
		});
	write(manifestPath, JSON.stringify(manifest, null, 2));
	return { manifestPath };
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
		const { manifestPath } = writeNativeHostManifest({
			xcshBinPath: process.execPath,
			extensionIds: EXTENSION_IDS,
		});
		return `Installed native-messaging host manifest at ${manifestPath} (extensions ${EXTENSION_IDS.join(", ")}). Load the xcsh Chrome extension, then it can drive your real Chrome.`;
	}
	// relaunch: self-consented rung 3 — force allowRelaunch regardless of the setting.
	const { mode } = await acquirePage({ settings, allowRelaunch: true });
	return `Chrome ready (${mode}). Your real, logged-in session is now debuggable for xcsh.`;
}
