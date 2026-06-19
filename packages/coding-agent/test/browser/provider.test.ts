import { describe, expect, it } from "bun:test";
import { CdpBrowserProvider } from "@f5xc-salesdemos/xcsh/browser/provider";

const settings = { get: (k: string) => (k === "browser.allowChromeRelaunch" ? false : undefined) };

describe("CdpBrowserProvider.status", () => {
	it("reports plannedAction=dedicated when Chrome runs without a port and relaunch is off", async () => {
		const p = new CdpBrowserProvider(settings as never, {
			probeDebuggable: async () => false,
			chromeRunning: () => true,
			chromeInstalled: () => true,
		});
		const s = await p.status();
		expect(s).toMatchObject({
			debuggableNow: false,
			chromeRunning: true,
			chromeInstalled: true,
			plannedAction: "dedicated",
		});
		expect(s.detail.length).toBeGreaterThan(0);
	});
	it("reports plannedAction=attach when a debuggable Chrome is reachable", async () => {
		const p = new CdpBrowserProvider(settings as never, {
			probeDebuggable: async () => true,
			chromeRunning: () => true,
			chromeInstalled: () => true,
		});
		expect((await p.status()).plannedAction).toBe("attach");
	});
	it("reports no-chrome when Chrome is not installed", async () => {
		const p = new CdpBrowserProvider(settings as never, {
			probeDebuggable: async () => false,
			chromeRunning: () => false,
			chromeInstalled: () => false,
		});
		expect((await p.status()).plannedAction).toBe("no-chrome");
	});
});
