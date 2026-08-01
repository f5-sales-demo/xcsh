import { describe, expect, it } from "bun:test";
import { CdpBrowserProvider } from "../../src/browser/provider";

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

describe("CdpBrowserProvider.release", () => {
	it("restores the default profile without debugging after an xcsh relaunch", async () => {
		const calls: string[] = [];
		const provider = new CdpBrowserProvider(
			{
				get: key => key === "browser.dropPortAfter",
			},
			undefined,
			{
				acquirePage: async () => ({
					browser: {
						disconnect: async () => {
							calls.push("disconnect");
						},
					} as never,
					page: {} as never,
					mode: "relaunched-default",
				}),
				ensureAuthenticated: async () => {},
				restoreDefaultChromeWithoutDebugPort: async () => {
					calls.push("restore");
				},
			},
		);

		const acquired = await provider.acquire("https://console.example.test");
		await acquired.release();

		expect(calls).toEqual(["disconnect", "restore"]);
	});

	it("does not restart Chrome for an attached browser", async () => {
		let restored = false;
		const provider = new CdpBrowserProvider({ get: key => key === "browser.dropPortAfter" }, undefined, {
			acquirePage: async () => ({
				browser: { disconnect: async () => {} } as never,
				page: {} as never,
				mode: "attached",
			}),
			ensureAuthenticated: async () => {},
			restoreDefaultChromeWithoutDebugPort: async () => {
				restored = true;
			},
		});

		await (await provider.acquire("https://console.example.test")).release();

		expect(restored).toBe(false);
	});
});
