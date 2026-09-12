import { beforeAll, expect, test, vi } from "bun:test";
import type { Component } from "@f5-sales-demo/pi-tui";
import { acquirePage, type BrowserAcquisitionStep } from "../../src/browser/acquire";
import { Settings } from "../../src/config/settings";
import { getThemeByName, setThemeInstance } from "../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../src/modes/types";
import {
	type ChromeReviewTarget,
	handleBrowserModeCommand,
	handleChromeCommand,
} from "../../src/slash-commands/browser-command";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
const chromeFixture: ChromeReviewTarget = {
	endpoint: "http://127.0.0.1:9222",
	executable: "/fixture/chrome",
	profile: "/fixture/profile",
	fallback: "/fixture/fallback",
	configured: false,
	running: true,
	debuggable: false,
};
test("acquisition calls the review boundary before even attempting attachment", async () => {
	const beforeAction = vi.fn(async () => {
		throw new Error("Fixture review rejected");
	});
	await expect(acquirePage({ settings: { get: () => undefined }, beforeAction })).rejects.toThrow(
		"Fixture review rejected",
	);
	expect(beforeAction).toHaveBeenCalledWith({ action: "attach", endpoint: "http://127.0.0.1:9222" });
});
test("configured attachment failure reports the selected endpoint port", async () => {
	await expect(
		acquirePage({
			settings: { get: key => (key === "browser.connectUrl" ? "http://127.0.0.1:1" : undefined) },
		}),
	).rejects.toThrow("--remote-debugging-port=1");
});
test("Chrome execution rejects changed destinations and unreviewed fallback paths before effects", async () => {
	for (const changed of [false, true]) {
		let target = chromeFixture;
		const h = harness([["\x1b[B", "\r"]]);
		const effect = vi.fn();
		const pending = handleChromeCommand(h.ctx, "relaunch", {
			inspect: async () => target,
			execute: async (_settings, beforeAction: (step: BrowserAcquisitionStep) => Promise<void>) => {
				if (changed) target = { ...target, executable: "/fixture/changed" };
				await beforeAction({
					action: "launch",
					endpoint: chromeFixture.endpoint,
					executable: chromeFixture.executable!,
					profile: changed ? chromeFixture.profile! : "/unreviewed/profile",
				});
				effect();
				return "launched-default";
			},
		});
		await waitFor(() => h.screens.length > 0 && h.text().includes("Review again."));
		expect(effect).not.toHaveBeenCalled();
		expect(h.ctx.showStatus).not.toHaveBeenCalled();
		h.input("\x1b");
		await pending;
		expect(h.ctx.showError).toHaveBeenCalled();
	}
});
test("Chrome status and invalid arguments never acquire a browser", async () => {
	const h = harness([]);
	const execute = vi.fn(async () => "attached" as const);
	const deps = { inspect: async () => ({ ...chromeFixture, configured: true, debuggable: true }), execute };
	await handleChromeCommand(h.ctx, "status", deps);
	await handleChromeCommand(h.ctx, "unknown", deps);
	expect(execute).not.toHaveBeenCalled();
	expect(h.ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining("Debug endpoint: reachable"));
	expect(h.ctx.showError).toHaveBeenCalledWith("Usage: /chrome [status|relaunch]");
});
test("Chrome invalid endpoint diagnostics never echo credentials or private URL content", async () => {
	for (const endpoint of [
		"SYNTHETIC_PRIVATE_TOKEN",
		"http://user:SYNTHETIC_PRIVATE_TOKEN@127.0.0.1:9222",
		"http://127.0.0.1:9222/?token=SYNTHETIC_PRIVATE_TOKEN",
	]) {
		const h = harness([]);
		h.settings.set("browser.connectUrl", endpoint);
		await handleChromeCommand(h.ctx, "status");
		expect(h.ctx.showError).toHaveBeenCalled();
		expect(JSON.stringify((h.ctx.showError as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
			"SYNTHETIC_PRIVATE_TOKEN",
		);
		expect(h.screens).toEqual([]);
	}
});
test("Chrome tracks non-cancellable work through duplicate input and closing attempts", async () => {
	let finish!: () => void;
	const running = new Promise<void>(resolve => {
		finish = resolve;
	});
	const execute = vi.fn(async () => {
		await running;
		return "attached" as const;
	});
	const dependencies = { inspect: async () => chromeFixture, execute };
	const h = harness([["\x1b[B", "\r"]]);
	const pending = handleChromeCommand(h.ctx, "relaunch", dependencies);
	await waitFor(() => execute.mock.calls.length === 1);
	h.input("\r");
	h.input("\x1b");
	h.input("\x03");
	await handleChromeCommand(h.ctx, "relaunch", dependencies);
	expect(execute).toHaveBeenCalledTimes(1);
	expect(h.ctx.showStatus).toHaveBeenCalledWith("A Chrome operation is already open.");
	expect(h.ctx.showError).not.toHaveBeenCalled();
	finish();
	await pending;
	expect(h.ctx.showStatus).toHaveBeenLastCalledWith("Chrome ready (attached). Authentication has not been verified.");
});
test("Chrome cancellation performs no acquisition; confirmation reports isolated fallback accurately", async () => {
	const execute = vi.fn(async () => "launched-dedicated" as const);
	const deps = { inspect: async () => chromeFixture, execute };
	const cancelled = harness([["\r"]]);
	await handleChromeCommand(cancelled.ctx, "relaunch", deps);
	expect(execute).not.toHaveBeenCalled();
	const h = harness([["\x1b[B", "\r"]]);
	await handleChromeCommand(h.ctx, "relaunch", deps);
	expect(execute).toHaveBeenCalledTimes(1);
	expect(h.ctx.showStatus).toHaveBeenCalledWith(
		"Chrome ready (launched-dedicated). Using an isolated profile, not your usual signed-in session.",
	);
});
test("Chrome changed target renews review and defaults back to Cancel", async () => {
	let target = chromeFixture;
	const execute = vi.fn(async () => "attached" as const);
	const h = harness([]);
	const pending = handleChromeCommand(h.ctx, "relaunch", { inspect: async () => target, execute });
	await waitFor(() => h.screens.length > 0);
	target = { ...chromeFixture, executable: "/fixture/replacement" };
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("/fixture/replacement"));
	expect(execute).not.toHaveBeenCalled();
	h.input("\r");
	await pending;
	expect(execute).not.toHaveBeenCalled();
});
function harness(inputs: string[][], override?: boolean) {
	const settings = Settings.isolated({
		"browser.enabled": true,
		...(override === undefined ? {} : { "browser.headless": override }),
	});
	settings.set("browser.headless", true);
	const write = vi.spyOn(settings, "set");
	const reset = vi.fn(async () => {});
	const tool = { restartForModeChange: reset };
	const screens: string[] = [];
	let current: Component;
	const ctx = {
		settings,
		session: { getToolByName: () => tool },
		showStatus: vi.fn(),
		showError: vi.fn(),
		showWarning: vi.fn(),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				const view = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
				current = view;
				screens.push(Bun.stripANSI(view.render(80).join("\n")));
				for (const key of inputs.shift() ?? []) view.handleInput?.(key);
			}),
	} as unknown as InteractiveModeContext;
	return {
		ctx,
		settings,
		write,
		reset,
		screens,
		input: (key: string) => current.handleInput?.(key),
		text: () => Bun.stripANSI(current.render(80).join("\n")),
	};
}
async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 200; i++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Expected browser review state missing");
}
test("browser without arguments presents explicit choices and defaults to Cancel", async () => {
	const h = harness([["\r"]]);
	await handleBrowserModeCommand(h.ctx, "");
	expect(h.screens[0]).toContain("Use visible browser");
	expect(h.write).not.toHaveBeenCalled();
	expect(h.reset).not.toHaveBeenCalled();
});
test("typed mode aliases share review, persist before reset, and cancel without mutation", async () => {
	for (const arg of ["visible", "show", "headful"]) {
		const cancelled = harness([["\r"]]);
		await handleBrowserModeCommand(cancelled.ctx, arg);
		expect(cancelled.write).not.toHaveBeenCalled();
		const h = harness([["\x1b[B", "\r"]]);
		const flush = vi.spyOn(h.settings, "flush");
		h.reset.mockImplementation(async () => {
			expect(flush).toHaveBeenCalledWith({ throwOnError: true });
		});
		await handleBrowserModeCommand(h.ctx, arg);
		expect(h.screens[0]).toContain("Review browser mode");
		expect(h.settings.inspectScopes("browser.headless").userValue).toBe(false);
		expect(h.reset).toHaveBeenCalledTimes(1);
		expect(h.ctx.showError).not.toHaveBeenCalled();
	}
});
test("masked user defaults are reviewed separately and do not reset an unchanged effective browser", async () => {
	const h = harness([["\x1b[B", "\r"]], true);
	await handleBrowserModeCommand(h.ctx, "visible");
	expect(h.screens[0]).toContain("override masks this default");
	expect(h.settings.inspectScopes("browser.headless").userValue).toBe(false);
	expect(h.settings.get("browser.headless")).toBe(true);
	expect(h.reset).not.toHaveBeenCalled();
});
test("status and unchanged defaults do not write or reset", async () => {
	const h = harness([]);
	await handleBrowserModeCommand(h.ctx, "status");
	await handleBrowserModeCommand(h.ctx, "headless");
	expect(h.write).not.toHaveBeenCalled();
	expect(h.reset).not.toHaveBeenCalled();
});

test("a failed reset reports saved preference and retries only unresolved work", async () => {
	const h = harness([]);
	h.reset.mockRejectedValueOnce(new Error("Fixture reset unavailable"));
	const pending = handleBrowserModeCommand(h.ctx, "visible");
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("Preference saved; browser reset failed"));
	expect(h.ctx.showStatus).not.toHaveBeenCalled();
	h.input("\r");
	await pending;
	expect(h.ctx.showError).toHaveBeenCalled();
	const retry = handleBrowserModeCommand(h.ctx, "visible");
	h.input("\x1b[B");
	h.input("\r");
	await retry;
	expect(h.write).toHaveBeenCalledTimes(1);
	expect(h.reset).toHaveBeenCalledTimes(2);
	expect(h.ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining("Browser default saved"));
});

test("override changes during save require renewed review before browser reset", async () => {
	const h = harness([]);
	const flush = h.settings.flush.bind(h.settings);
	vi.spyOn(h.settings, "flush").mockImplementation(async options => {
		await flush(options);
		h.settings.override("browser.headless", true);
	});
	const pending = handleBrowserModeCommand(h.ctx, "visible");
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("target or overrides changed"));
	expect(h.reset).not.toHaveBeenCalled();
	h.input("\r");
	await pending;
});

test("stale override removal changes the reset proposal and requires renewed confirmation", async () => {
	const h = harness([], true);
	const pending = handleBrowserModeCommand(h.ctx, "visible");
	h.settings.clearOverride("browser.headless");
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	expect(h.write).not.toHaveBeenCalled();
	expect(h.reset).not.toHaveBeenCalled();
	h.input("\r");
	await pending;
});
