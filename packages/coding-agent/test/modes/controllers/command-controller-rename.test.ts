import { afterEach, beforeAll, expect, test, vi } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { CommandController } from "../../../src/modes/controllers/command-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import { SessionManager } from "../../../src/session/session-manager";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
const directories: string[] = [];
afterEach(async () => {
	for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function harness(inputs: string[][]) {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-rename-uat-"));
	directories.push(dir);
	const manager = SessionManager.create(dir, dir);
	await manager.setSessionName("Original", "auto");
	await manager.ensureOnDisk();
	await manager.flush();
	const file = manager.getSessionFile()!;
	const before = await readFile(file, "utf8");
	const screens: string[] = [];
	let current: Component | undefined;
	const ctx = {
		sessionManager: manager,
		showStatus: vi.fn(),
		showError: vi.fn(),
		statusLine: { invalidate() {} },
		updateEditorBorderColor() {},
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
		manager,
		file,
		before,
		screens,
		controller: new CommandController(ctx),
		get current() {
			return current!;
		},
		text: () => Bun.stripANSI(current!.render(80).join("\n")),
	};
}

async function waitFor(predicate: () => boolean) {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Expected review state did not become available.");
}

test("cancelled typed rename leaves the session file byte-identical", async () => {
	const h = await harness([["\r"]]);
	await h.controller.handleRenameCommand("Proposed");
	expect(await readFile(h.file, "utf8")).toBe(h.before);
	expect(h.manager.getSessionName()).toBe("Original");
	expect(h.screens[0]).toContain("Review session rename");
	expect(h.screens[0]).toContain("Original");
	expect(h.screens[0]).toContain("Proposed");
});

test("typed and prefilled-editor rename persist the same reviewed name and identity", async () => {
	for (const typed of [true, false]) {
		const h = await harness(
			typed
				? [["\x1b[B", "\r"]]
				: [
						["\x15", "Proposed", "\r"],
						["\x1b[B", "\r"],
					],
		);
		const identity = h.manager.getSessionId();
		await h.controller.handleRenameCommand(typed ? "Proposed" : "");
		if (!typed) expect(h.screens[0]).toContain("Original");
		const reopened = await SessionManager.open(h.file);
		expect(reopened.getSessionName()).toBe("Proposed");
		expect(reopened.titleSource).toBe("user");
		expect(reopened.getSessionId()).toBe(identity);
		expect(h.ctx.showError).not.toHaveBeenCalled();
	}
});

test("unchanged and cancelled editor drafts cause no persistence calls", async () => {
	const h = await harness([["\x1b"]]);
	const write = vi.spyOn(h.manager, "setSessionName");
	const flush = vi.spyOn(h.manager, "flush");
	await h.controller.handleRenameCommand("Original");
	await h.controller.handleRenameCommand("");
	expect(write).not.toHaveBeenCalled();
	expect(flush).not.toHaveBeenCalled();
	expect(await readFile(h.file, "utf8")).toBe(h.before);
});

test("a stale reviewed title is replaced and requires renewed confirmation", async () => {
	const h = await harness([]);
	const pending = h.controller.handleRenameCommand("Proposed");
	await h.manager.setSessionName("Concurrent title", "auto");
	h.current.handleInput?.("\x1b[B");
	h.current.handleInput?.("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	expect(h.manager.getSessionName()).toBe("Concurrent title");
	expect(h.text()).toContain("Concurrent title");
	h.current.handleInput?.("\r"); // renewed review starts on Cancel
	await pending;
	expect((await SessionManager.open(h.file)).getSessionName()).toBe("Concurrent title");
});

test("duplicate entry and submission cannot rename twice while saving", async () => {
	const h = await harness([]);
	const original = h.manager.setSessionName.bind(h.manager);
	let release!: () => void;
	const gate = new Promise<void>(resolve => {
		release = resolve;
	});
	const write = vi.spyOn(h.manager, "setSessionName").mockImplementation(async (name, source) => {
		await gate;
		return original(name, source);
	});
	const pending = h.controller.handleRenameCommand("Proposed");
	h.current.handleInput?.("\x1b[B");
	h.current.handleInput?.("\r");
	await waitFor(() => write.mock.calls.length === 1);
	h.current.handleInput?.("\r");
	h.current.handleInput?.("\x1b");
	await h.controller.handleRenameCommand("Other");
	expect(write).toHaveBeenCalledTimes(1);
	expect(h.screens).toHaveLength(1);
	release();
	await pending;
	expect((await SessionManager.open(h.file)).getSessionName()).toBe("Proposed");
});

test("failed persistence remains unresolved and a later command retries the pending name", async () => {
	const h = await harness([]);
	const flush = vi.spyOn(h.manager, "flush").mockRejectedValueOnce(new Error("Fixture fsync failure"));
	const pending = h.controller.handleRenameCommand("Proposed");
	h.current.handleInput?.("\x1b[B");
	h.current.handleInput?.("\r");
	await waitFor(() => h.text().includes("Fixture fsync failure"));
	expect(h.ctx.showStatus).not.toHaveBeenCalled();
	h.current.handleInput?.("\r");
	await pending;
	expect(h.ctx.showError).toHaveBeenCalled();
	const retry = h.controller.handleRenameCommand("Proposed");
	h.current.handleInput?.("\x1b[B");
	h.current.handleInput?.("\r");
	await retry;
	expect(flush).toHaveBeenCalledTimes(2);
	expect((await SessionManager.open(h.file)).getSessionName()).toBe("Proposed");
});
