import { beforeAll, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { getThemeByName, setThemeInstance } from "../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../src/modes/types";
import { SessionManager } from "../../src/session/session-manager";
import { FileSessionStorage } from "../../src/session/session-storage";
import { handleFastCommand } from "../../src/slash-commands/fast-command";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
function harness(inputs: string[][]) {
	let enabled = false;
	const setFastMode = vi.fn((value: boolean) => {
		enabled = value;
	});
	const flush = vi.fn(async () => {});
	const showStatus = vi.fn();
	const screens: string[] = [];
	let current: Component;
	const ctx = {
		session: {
			isFastModeEnabled: () => enabled,
			setFastMode,
			get serviceTier() {
				return enabled ? "priority" : undefined;
			},
		},
		sessionManager: { getSessionId: () => "fixture", flush, retryPersistence: flush },
		showStatus,
		showError: vi.fn(),
		statusLine: { invalidate() {} },
		updateEditorTopBorder() {},
		ui: { requestRender() {} },
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (result: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				const component = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
				current = component;
				screens.push(Bun.stripANSI(component.render(80).join("\n")));
				for (const input of inputs.shift() ?? []) component.handleInput?.(input);
			}),
	} as unknown as InteractiveModeContext;
	return {
		ctx,
		setFastMode,
		flush,
		showStatus,
		screens,
		input: (key: string) => current.handleInput?.(key),
		text: () => Bun.stripANSI(current.render(80).join("\n")),
	};
}
test("argument-free fast mode offers explicit choices and defaults to no change", async () => {
	const h = harness([["\r"]]);
	await handleFastCommand(h.ctx, "");
	expect(h.screens[0]).toContain("Enable fast mode");
	expect(h.screens[0]).toContain("Disable fast mode");
	expect(h.setFastMode).not.toHaveBeenCalled();
	expect(h.flush).not.toHaveBeenCalled();
});
test("typed fast on and the menu share review and flush before reporting success", async () => {
	for (const arg of ["on", ""]) {
		const h = harness(
			arg
				? [["\x1b[B", "\r"]]
				: [
						["\x1b[B", "\r"],
						["\x1b[B", "\r"],
					],
		);
		await handleFastCommand(h.ctx, arg);
		expect(h.screens.at(-1)).toContain("Review fast mode");
		expect(h.setFastMode).toHaveBeenCalledWith(true);
		expect(h.flush).toHaveBeenCalledTimes(1);
		expect(h.showStatus).toHaveBeenCalledWith("Fast mode enabled for this session.");
	}
});
test("typed review cancellation and status do not mutate session state", async () => {
	const h = harness([["\r"]]);
	await handleFastCommand(h.ctx, "on");
	await handleFastCommand(h.ctx, "status");
	expect(h.setFastMode).not.toHaveBeenCalled();
	expect(h.flush).not.toHaveBeenCalled();
});
test("unchanged fast mode does not flush or write session history", async () => {
	const h = harness([]);
	await handleFastCommand(h.ctx, "off");
	expect(h.setFastMode).not.toHaveBeenCalled();
	expect(h.flush).not.toHaveBeenCalled();
});
test("failed fast-mode disk save is reviewed and recovered without duplicate history", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-fast-save-"));
	const storage = new FileSessionStorage();
	const open = storage.openWriter.bind(storage);
	let fail = false;
	vi.spyOn(storage, "openWriter").mockImplementation((file, options) => {
		const writer = open(file, options);
		return {
			writeLine: value => writer.writeLine(value),
			flush: () => writer.flush(),
			close: () => writer.close(),
			getError: () => writer.getError(),
			fsync: async () => {
				if (fail) {
					fail = false;
					throw new Error("Fixture fast fsync failure");
				}
				await writer.fsync();
			},
		};
	});
	try {
		const manager = SessionManager.create(root, join(root, "sessions"), storage);
		await manager.ensureOnDisk();
		const h = harness([["\x1b[B", "\r"]]);
		h.ctx.sessionManager = manager;
		let enabled = false;
		h.ctx.session.isFastModeEnabled = () => enabled;
		Object.defineProperty(h.ctx.session, "serviceTier", { get: () => (enabled ? "priority" : undefined) });
		h.setFastMode.mockImplementation(value => {
			enabled = value;
			manager.appendServiceTierChange(value ? "priority" : null);
		});
		fail = true;
		const pending = handleFastCommand(h.ctx, "on");
		for (let i = 0; i < 300 && !h.text().includes("Fixture fast fsync failure"); i++) await Bun.sleep(1);
		expect(h.text()).toContain("Fixture fast fsync failure");
		expect(h.showStatus).not.toHaveBeenCalled();
		h.input("\x1b");
		await pending;
		await expect(manager.flush()).rejects.toThrow("Fixture fast fsync failure");
		const retry = handleFastCommand(h.ctx, "on");
		expect(h.screens).toHaveLength(2);
		h.input("\x1b[B");
		h.input("\r");
		await retry;
		expect(h.setFastMode).toHaveBeenCalledTimes(1);
		expect(h.showStatus).toHaveBeenLastCalledWith("Fast mode enabled for this session.");
		const reopened = await SessionManager.open(manager.getSessionFile()!);
		expect(reopened.buildSessionContext().serviceTier).toBe("priority");
		expect(reopened.getEntries().filter(entry => entry.type === "service_tier_change")).toHaveLength(1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
