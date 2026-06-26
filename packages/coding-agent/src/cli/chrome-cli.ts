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

/**
 * Baked-in Chrome Web Store URL for the xcsh console-automation extension.
 * Surfaced to the user when the extension is not installed/connected so they
 * have a one-click install path instead of a dead end.
 */
export const WEB_STORE_URL = `https://chromewebstore.google.com/detail/${EXTENSION_ID}`;

const NATIVE_HOST_NAME = "com.xcsh.xcsh.chrome_host";

/**
 * How Chrome should invoke the native-messaging relay. A compiled `xcsh`
 * binary resolves `chrome-host` as a subcommand directly (path=xcsh,
 * args=["chrome-host"]). Under a dev run (`bun src/cli.ts …`) `process.execPath`
 * is `bun`, which needs the entry script path to resolve the subcommand —
 * otherwise Chrome launches `bun chrome-host`, which fails, and the bridge never
 * comes up. This makes the manifest correct for BOTH invocations.
 */
export function nativeHostInvocation(
	argv = process.argv,
	execPath = process.execPath,
): {
	binPath: string;
	args: string[];
} {
	const base = path.basename(execPath).toLowerCase();
	if (base.startsWith("bun")) {
		const script = argv[1];
		if (script && (script.endsWith(".ts") || script.endsWith(".js"))) {
			return { binPath: execPath, args: [script, "chrome-host"] };
		}
	}
	return { binPath: execPath, args: ["chrome-host"] };
}

/**
 * Idempotently ensure the native-messaging host manifest is installed and
 * correct. Safe to call on every console-automation init — it only writes when
 * the manifest is missing or differs, so it's transparent to the user and
 * removes the need to run `xcsh chrome setup` by hand. Returns whether a write
 * occurred and the manifest path.
 */
export function ensureNativeHostInstalled(opts?: {
	platform?: NodeJS.Platform;
	home?: string;
	argv?: string[];
	execPath?: string;
	devExtensionId?: string;
}): { manifestPath: string; changed: boolean } {
	const platform = opts?.platform ?? process.platform;
	const home = opts?.home ?? os.homedir();
	if (platform === "win32") return { manifestPath: "", changed: false };
	const { binPath, args } = nativeHostInvocation(opts?.argv, opts?.execPath);
	const dir = nativeHostDir(platform, home);
	const manifestPath = path.join(dir, `${NATIVE_HOST_NAME}.json`);
	// Dev affordance: an unpacked/local extension build loads under a different
	// (key- or path-derived) id than the published one. Setting
	// XCSH_DEV_EXTENSION_ID lets the native host also trust that build so you can
	// iterate locally without editing this file. Ignored in normal use.
	const devId = (opts?.devExtensionId ?? process.env.XCSH_DEV_EXTENSION_ID)?.trim();
	const ids = devId && !EXTENSION_IDS.includes(devId) ? [...EXTENSION_IDS, devId] : EXTENSION_IDS;
	const desired = JSON.stringify(
		{
			name: NATIVE_HOST_NAME,
			description: "xcsh Chrome native-messaging host",
			path: binPath,
			args,
			type: "stdio",
			allowed_origins: ids.map(id => `chrome-extension://${id}/`),
		},
		null,
		2,
	);
	let existing: string | null = null;
	try {
		existing = fs.readFileSync(manifestPath, "utf8");
	} catch {
		/* missing — will write */
	}
	if (existing === desired) return { manifestPath, changed: false };
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(manifestPath, desired);
	return { manifestPath, changed: true };
}

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
		// Idempotent: only writes when missing/stale. This is also run automatically
		// on console-automation init, so `xcsh chrome setup` is optional now.
		const { manifestPath, changed } = ensureNativeHostInstalled();
		const state = changed ? "Installed" : "Verified (already current)";
		return (
			`${state} native-messaging host manifest at ${manifestPath} (extensions ${EXTENSION_IDS.join(", ")}).\n` +
			`Install/keep the xcsh Chrome extension from the Web Store, then it can drive your real Chrome:\n  ${WEB_STORE_URL}`
		);
	}
	// relaunch: self-consented rung 3 — force allowRelaunch regardless of the setting.
	const { mode } = await acquirePage({ settings, allowRelaunch: true });
	return `Chrome ready (${mode}). Your real, logged-in session is now debuggable for xcsh.`;
}
