import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import type { Browser, Page } from "puppeteer";
import { assertLoopbackBrowserUrl, pickCoDrivePage, resolveBrowserConnectUrl } from "../tools/browser";
import { locateChrome } from "./chrome-locate";

export type AcquireMode = "attached" | "launched-default" | "launched-dedicated" | "relaunched-default";

const DEFAULT_DEBUG_PORT = 9222;

export function dedicatedProfileDir(home: string = os.homedir()): string {
	return path.join(home, ".xcsh", "chrome-profile");
}

export function defaultProfileDir(opts?: {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	home?: string;
}): string | null {
	const platform = opts?.platform ?? process.platform;
	const env = opts?.env ?? process.env;
	const home = opts?.home ?? os.homedir();
	switch (platform) {
		case "darwin":
			return path.join(home, "Library", "Application Support", "Google", "Chrome");
		case "linux":
			return path.join(home, ".config", "google-chrome");
		case "win32": {
			const localAppData = env.LOCALAPPDATA;
			if (!localAppData) return null;
			return path.join(localAppData, "Google", "Chrome", "User Data");
		}
		default:
			return null;
	}
}

async function withLaunchTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error("launch timed out")), ms);
	});
	try {
		return await Promise.race([p, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export function buildLaunchArgs(opts: { profileDir?: string; debugPort: number }): string[] {
	const args = [
		`--remote-debugging-port=${opts.debugPort}`,
		"--remote-debugging-address=127.0.0.1",
		"--no-first-run",
		"--no-default-browser-check",
	];
	if (opts.profileDir) args.push(`--user-data-dir=${opts.profileDir}`);
	return args;
}

export type AcquireAction = "attach" | "launch" | "relaunch" | "dedicated" | "no-chrome";

export function decideAcquireAction(state: {
	debuggableNow: boolean;
	chromeRunning: boolean;
	chromeInstalled: boolean;
	allowRelaunch: boolean;
}): AcquireAction {
	if (!state.chromeInstalled) return "no-chrome";
	if (state.debuggableNow) return "attach";
	if (!state.chromeRunning) return "launch";
	return state.allowRelaunch ? "relaunch" : "dedicated";
}

/** Graceful (never force) quit command for the user's Chrome, per OS. */
export function quitChromeCommand(
	platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[] } | null {
	switch (platform) {
		case "darwin":
			return { cmd: "osascript", args: ["-e", 'quit app "Google Chrome"'] };
		case "linux":
			return { cmd: "pkill", args: ["-TERM", "-x", "chrome"] };
		case "win32":
			return { cmd: "taskkill", args: ["/IM", "chrome.exe"] };
		default:
			return null;
	}
}

export function isProfileLockError(message: string): boolean {
	// Chrome's own SingletonLock messages, plus Puppeteer's message when an
	// explicit --user-data-dir is already held by a running browser
	// ("The browser is already running for <dir>. Use a different `userDataDir` …").
	return /singletonlock|processsingleton|profile appears to be in use|create a processsingleton|already running for|use a different\s+`?userdatadir/i.test(
		message,
	);
}

function defaultExec(cmd: string, args: string[]): { code: number } {
	try {
		execFileSync(cmd, args, { stdio: "ignore" });
		return { code: 0 };
	} catch (e) {
		const code = (e as { status?: number }).status;
		return { code: typeof code === "number" ? code : 1 };
	}
}

export function isChromeRunning(
	opts: { platform?: NodeJS.Platform; exec?: (cmd: string, args: string[]) => { code: number } } = {},
): boolean {
	const platform = opts.platform ?? process.platform;
	const exec = opts.exec ?? defaultExec;
	if (platform === "win32") {
		// tasklist always exits 0; use FILTER so a no-match is a non-zero/empty result.
		return exec("tasklist", ["/FI", "IMAGENAME eq chrome.exe", "/NH"]).code === 0;
	}
	// darwin/linux: pgrep exits 0 when a match exists, 1 otherwise.
	const pattern = platform === "darwin" ? "Google Chrome" : "chrome";
	return exec("pgrep", ["-x", pattern]).code === 0;
}

async function waitForChromeExit(timeoutMs = 8000, pollMs = 300): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isChromeRunning()) return true;
		await new Promise(r => setTimeout(r, pollMs));
	}
	return false;
}

async function tryAttach(browserURL: string): Promise<{ browser: Browser; page: Page } | null> {
	const puppeteer = (await import("puppeteer")).default;
	try {
		const browser = await puppeteer.connect({ browserURL });
		const pages = await browser.pages();
		const page = pages.length ? pages[pickCoDrivePage(pages)]! : await browser.newPage();
		return { browser, page };
	} catch {
		return null;
	}
}

async function launch(executablePath: string, args: string[]): Promise<Browser> {
	const puppeteer = (await import("puppeteer")).default;
	return puppeteer.launch({ headless: false, executablePath, args, defaultViewport: null });
}

export async function acquirePage(opts: {
	settings: { get(key: string): unknown };
	debugPort?: number;
	allowRelaunch?: boolean;
}): Promise<{ browser: Browser; page: Page; mode: AcquireMode }> {
	const debugPort = opts.debugPort ?? DEFAULT_DEBUG_PORT;
	const configuredUrl = resolveBrowserConnectUrl(opts.settings);
	const attachUrl = configuredUrl ?? `http://127.0.0.1:${debugPort}`;
	assertLoopbackBrowserUrl(attachUrl);

	// 1) Attach to a Chrome already exposing the debug port.
	const attached = await tryAttach(attachUrl);
	if (attached) return { ...attached, mode: "attached" };

	// If the user explicitly configured connectUrl but nothing is there, that is an error
	// (do not silently launch a different browser than they asked to attach to).
	if (configuredUrl) {
		throw new Error(
			`Could not attach to Chrome at ${configuredUrl}. Start Chrome with --remote-debugging-port=${debugPort} and retry, or unset browser.connectUrl to let xcsh launch Chrome.`,
		);
	}

	const located = locateChrome({ settings: opts.settings });
	if (!located) {
		throw new Error(
			"Google Chrome not found. Install Google Chrome, or set the browser.chromePath setting to your Chrome/Chromium executable.",
		);
	}

	// 2) Launch the user's installed Chrome with their DEFAULT profile + debug port.
	// We pass --user-data-dir EXPLICITLY (Chrome's implicit default profile would hand off
	// to an already-running Chrome and exit, leaving puppeteer.launch hanging on a debug
	// endpoint that never appears). A timeout guards against that handoff case so we can
	// fall through to a dedicated profile instead of hanging.
	const defaultDir = defaultProfileDir();
	if (defaultDir) {
		try {
			const browser = await withLaunchTimeout(
				launch(located.path, buildLaunchArgs({ debugPort, profileDir: defaultDir })),
				12_000,
			);
			const pages = await browser.pages();
			const page = pages.length ? pages[0]! : await browser.newPage();
			return { browser, page, mode: "launched-default" };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			// Profile locked (Chrome already running) or the launch timed out (handoff to a
			// running instance) → fall through to a dedicated, xcsh-owned profile.
			if (!isProfileLockError(msg) && !msg.includes("launch timed out")) throw err;

			// Resolve relaunch consent: explicit opt, else the setting.
			const allowRelaunch = opts.allowRelaunch ?? opts.settings.get("browser.allowChromeRelaunch") === true;
			// 3) Chrome running without the port → consented quit + relaunch on the real profile.
			if (allowRelaunch) {
				const quit = quitChromeCommand();
				if (quit) {
					try {
						execFileSync(quit.cmd, quit.args, { stdio: "ignore" });
					} catch {
						/* ignore quit errors; verify via waitForChromeExit */
					}
					const exited = await waitForChromeExit();
					if (exited) {
						const browser = await withLaunchTimeout(
							launch(located.path, buildLaunchArgs({ debugPort, profileDir: defaultDir })),
							12_000,
						);
						const pages = await browser.pages();
						const page = pages.length ? pages[0]! : await browser.newPage();
						return { browser, page, mode: "relaunched-default" };
					}
					// quit timed out → DO NOT relaunch (avoid two instances / data loss); fall through to dedicated.
				}
			}
		}
	}

	// 4) Default profile unavailable (locked / handoff / unsupported platform) → dedicated
	// xcsh-owned profile. A previous xcsh-launched Chrome on this profile may still be
	// running (close() only disconnects, never terminates), so this launch can hit the
	// same SingletonLock/handoff and hang. Guard it with a timeout; there is no further
	// fallback, so a timeout/lock error is fatal.
	const profileDir = dedicatedProfileDir();
	let browser: Browser;
	try {
		browser = await withLaunchTimeout(launch(located.path, buildLaunchArgs({ debugPort, profileDir })), 12_000);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("launch timed out") || isProfileLockError(msg)) {
			throw new Error(
				"Could not launch Chrome on the dedicated xcsh profile (it may already be in use); close other xcsh-launched Chrome windows and retry.",
			);
		}
		throw err;
	}
	const pages = await browser.pages();
	const page = pages.length ? pages[0]! : await browser.newPage();
	return { browser, page, mode: "launched-dedicated" };
}
