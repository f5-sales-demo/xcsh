import * as os from "node:os";
import * as path from "node:path";
import type { Browser, Page } from "puppeteer";
import { assertLoopbackBrowserUrl, pickCoDrivePage, resolveBrowserConnectUrl } from "../tools/browser";
import { locateChrome } from "./chrome-locate";

export type AcquireMode = "attached" | "launched-default" | "launched-dedicated";

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
	const args = [`--remote-debugging-port=${opts.debugPort}`, "--no-first-run", "--no-default-browser-check"];
	if (opts.profileDir) args.push(`--user-data-dir=${opts.profileDir}`);
	return args;
}

export function isProfileLockError(message: string): boolean {
	return /singletonlock|processsingleton|profile appears to be in use|create a processsingleton/i.test(message);
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
		}
	}

	// 3) Default profile unavailable (locked / handoff / unsupported platform) → dedicated
	// xcsh-owned profile. This dir won't be locked, so no timeout is needed here.
	const profileDir = dedicatedProfileDir();
	const browser = await launch(located.path, buildLaunchArgs({ debugPort, profileDir }));
	const pages = await browser.pages();
	const page = pages.length ? pages[0]! : await browser.newPage();
	return { browser, page, mode: "launched-dedicated" };
}
