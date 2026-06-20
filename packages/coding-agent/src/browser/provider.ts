import { type AcquireAction, acquirePage, decideAcquireAction, isChromeRunning } from "./acquire";
import { ensureAuthenticated } from "./auth";
import { CdpPageActions } from "./cdp-page-actions";
import { locateChrome } from "./chrome-locate";
import { startBridgeServer } from "./extension-bridge";
import { ExtensionBrowserProvider } from "./extension-provider";
import type { PageActions } from "./page-actions";

export interface AcquiredBrowser {
	page: PageActions;
	mode: string;
	release(): Promise<void>;
}

export interface BrowserProviderStatus {
	debuggableNow: boolean;
	chromeRunning: boolean;
	chromeInstalled: boolean;
	plannedAction: AcquireAction;
	detail: string;
}

export interface BrowserProvider {
	readonly name: string;
	acquire(consoleUrl: string): Promise<AcquiredBrowser>;
	status(): Promise<BrowserProviderStatus>;
}

type Settings = { get(key: string): unknown };
const DEBUG_PORT = 9222;

/** Probe the loopback debug endpoint without attaching. */
async function probeDebuggableDefault(): Promise<boolean> {
	try {
		const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
		return r.ok;
	} catch {
		return false;
	}
}

const DETAIL: Record<AcquireAction, string> = {
	attach: "A debuggable Chrome is reachable on 127.0.0.1:9222 — xcsh will attach and co-drive it.",
	launch: "Chrome is installed and not running — xcsh will launch it on your real profile with a loopback debug port.",
	relaunch:
		"Your Chrome is running without a debug port — xcsh will gracefully quit and reopen it on your real profile (consent granted).",
	dedicated:
		"Your Chrome is running without a debug port and relaunch is off — xcsh will use an isolated profile (run `/chrome relaunch` or set browser.allowChromeRelaunch to use your real session).",
	"no-chrome": "Google Chrome was not found — install it or set browser.chromePath.",
};

export class CdpBrowserProvider implements BrowserProvider {
	readonly name = "cdp";
	#settings: Settings;
	#probes: { probeDebuggable: () => Promise<boolean>; chromeRunning: () => boolean; chromeInstalled: () => boolean };

	constructor(
		settings: Settings,
		probes?: {
			probeDebuggable: () => Promise<boolean>;
			chromeRunning: () => boolean;
			chromeInstalled: () => boolean;
		},
	) {
		this.#settings = settings;
		this.#probes = probes ?? {
			probeDebuggable: probeDebuggableDefault,
			chromeRunning: () => isChromeRunning(),
			chromeInstalled: () => locateChrome({ settings }) != null,
		};
	}

	async status(): Promise<BrowserProviderStatus> {
		const debuggableNow = await this.#probes.probeDebuggable();
		const chromeRunning = this.#probes.chromeRunning();
		const chromeInstalled = this.#probes.chromeInstalled();
		const allowRelaunch = this.#settings.get("browser.allowChromeRelaunch") === true;
		const plannedAction = decideAcquireAction({ debuggableNow, chromeRunning, chromeInstalled, allowRelaunch });
		return { debuggableNow, chromeRunning, chromeInstalled, plannedAction, detail: DETAIL[plannedAction] };
	}

	async acquire(consoleUrl: string): Promise<AcquiredBrowser> {
		const { browser, page, mode } = await acquirePage({ settings: this.#settings, debugPort: DEBUG_PORT });
		await ensureAuthenticated(page, consoleUrl);
		const dropPort = this.#settings.get("browser.dropPortAfter") === true;
		const relaunched = mode === "relaunched-default";
		return {
			page: new CdpPageActions(page),
			mode,
			release: async () => {
				await browser.disconnect().catch(() => {});
				// dropPortAfter: only meaningful when WE opened the port via relaunch; reopening
				// the real profile without the flag is itself a relaunch — gate it tightly.
				if (dropPort && relaunched) {
					// Best-effort: leave to a follow-up; never force-kill. (No-op stub acceptable here —
					// the port closes when the user next restarts Chrome. See spec "dropPortAfter".)
				}
			},
		};
	}
}

/**
 * Select the best available browser provider: if the Chrome extension bridge is
 * reachable (the extension is loaded + xcsh chrome setup ran), use it (real profile,
 * no debug port needed). Otherwise fall back to CDP (dedicated profile).
 *
 * The probe is bounded: if the extension doesn't connect within `probeTimeoutMs`,
 * the CDP provider is used — so this never blocks a session indefinitely.
 */
export async function selectProvider(settings: Settings, opts?: { probeTimeoutMs?: number }): Promise<BrowserProvider> {
	const probeMs = opts?.probeTimeoutMs ?? 5_000;
	try {
		const server = await startBridgeServer();
		const deadline = Date.now() + probeMs;
		while (Date.now() < deadline) {
			if (server.connected) {
				return new ExtensionBrowserProvider({ server });
			}
			await new Promise(r => setTimeout(r, 300));
		}
		await server.close();
	} catch {
		// Bridge server failed to start — fall back silently.
	}
	return new CdpBrowserProvider(settings);
}
