import { afterEach, beforeAll, expect, test, vi } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { CommandController } from "../../../src/modes/controllers/command-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import { type NewSessionOptions, SessionManager, type SessionNewPreview } from "../../../src/session/session-manager";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
const directories: string[] = [];
afterEach(async () => {
	for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function harness() {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-new-session-uat-"));
	directories.push(dir);
	const manager = SessionManager.create(dir, dir);
	manager.appendMessage({ role: "user", content: "Synthetic previous conversation", timestamp: 1 });
	await manager.ensureOnDisk();
	await manager.flush();
	const previousFile = manager.getSessionFile()!;
	const previousBytes = await readFile(previousFile, "utf8");
	const cleared = vi.fn();
	const container = { clear: cleared, addChild() {} };
	let component: Component;
	const newSession = vi.fn(async (options?: NewSessionOptions, preview?: SessionNewPreview) => {
		await manager.newSession(options, preview);
		return true;
	});
	const ctx = {
		sessionManager: manager,
		session: { newSession, isStreaming: false, isCompacting: false },
		compactionQueuedMessages: [],
		pendingTools: new Map(),
		chatContainer: container,
		statusContainer: container,
		pendingMessagesContainer: container,
		statusLine: { invalidate() {}, setSessionStartTime() {} },
		ui: { requestRender() {} },
		resetObserverRegistry() {},
		updateEditorTopBorder() {},
		updateEditorBorderColor() {},
		rebuildChatFromMessages: vi.fn(),
		reloadTodos: async () => {},
		showStatus: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				component = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
			}),
	} as unknown as InteractiveModeContext;
	return {
		ctx,
		manager,
		previousFile,
		previousBytes,
		cleared,
		newSession,
		controller: new CommandController(ctx),
		input: (data: string) => component.handleInput?.(data),
		text: () => Bun.stripANSI(component.render(80).join("\n")),
	};
}
async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 200; i++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Expected dialog state missing");
}
function failNewSessionSaveOnce(manager: SessionManager) {
	const oldId = manager.getSessionId();
	const ensure = manager.ensureOnDisk.bind(manager);
	let failed = false;
	vi.spyOn(manager, "ensureOnDisk").mockImplementation(async () => {
		if (!failed && manager.getSessionId() !== oldId) {
			failed = true;
			throw new Error("Fixture disk failure");
		}
		await ensure();
	});
}
test("cancelled new-session review preserves bytes, identity and visible conversation", async () => {
	const h = await harness();
	const id = h.manager.getSessionId();
	const pending = h.controller.handleClearCommand();
	expect(h.text()).toContain("Review new session");
	h.input("\r");
	await pending;
	expect(h.newSession).not.toHaveBeenCalled();
	expect(h.cleared).not.toHaveBeenCalled();
	expect(h.manager.getSessionId()).toBe(id);
	expect(await readFile(h.previousFile, "utf8")).toBe(h.previousBytes);
});
test("confirmed new session is reopenable and preserves the previous conversation file", async () => {
	const h = await harness();
	const pending = h.controller.handleClearCommand();
	h.input("\x1b[B");
	h.input("\r");
	h.input("\r");
	await pending;
	expect(h.newSession).toHaveBeenCalledTimes(1);
	expect(h.ctx.showError).not.toHaveBeenCalled();
	expect(h.cleared).toHaveBeenCalled();
	const reopened = await SessionManager.open(h.manager.getSessionFile()!);
	expect(reopened.getSessionId()).toBe(h.manager.getSessionId());
	expect(h.manager.getSessionFile()).not.toBe(h.previousFile);
	expect(await readFile(h.previousFile, "utf8")).toBe(h.previousBytes);
});
test("extension veto retains the existing UI instead of claiming a new session", async () => {
	const h = await harness();
	h.newSession.mockResolvedValueOnce(false);
	const pending = h.controller.handleClearCommand();
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("declined by an extension"));
	h.input("\r");
	await pending;
	expect(h.cleared).not.toHaveBeenCalled();
	expect(h.ctx.showError).toHaveBeenCalled();
	expect(await readFile(h.previousFile, "utf8")).toBe(h.previousBytes);
});

test("retry after new-session persistence failure completes the same identity without creating another", async () => {
	const h = await harness();
	failNewSessionSaveOnce(h.manager);
	const pending = h.controller.handleClearCommand();
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("Fixture disk failure"));
	const createdId = h.manager.getSessionId();
	expect(h.cleared).not.toHaveBeenCalled();
	h.input("\x1b[B");
	h.input("\r");
	await pending;
	expect(h.newSession).toHaveBeenCalledTimes(1);
	expect(h.manager.getSessionId()).toBe(createdId);
	expect((await SessionManager.open(h.manager.getSessionFile()!)).getSessionId()).toBe(createdId);
	expect(h.ctx.showError).not.toHaveBeenCalled();
});

test("closing a partial-save failure shows actual session state and later /new recovers that session", async () => {
	const h = await harness();
	failNewSessionSaveOnce(h.manager);
	const pending = h.controller.handleClearCommand();
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("Fixture disk failure"));
	const createdId = h.manager.getSessionId();
	h.input("\r");
	await pending;
	expect(h.ctx.rebuildChatFromMessages).toHaveBeenCalledTimes(1);
	expect(h.ctx.showError).toHaveBeenCalledWith(expect.stringContaining(createdId));
	const retry = h.controller.handleClearCommand();
	expect(h.text()).toContain("Review session save recovery");
	h.input("\x1b[B");
	h.input("\r");
	await retry;
	expect(h.newSession).toHaveBeenCalledTimes(1);
	expect((await SessionManager.open(h.manager.getSessionFile()!)).getSessionId()).toBe(createdId);
	expect(h.cleared).not.toHaveBeenCalled();
});

test("reviewed new-session destinations are exact and never overwrite a colliding file", async () => {
	const h = await harness();
	const sourceId = h.manager.getSessionId();
	const preview = h.manager.previewNewSession();
	if (!preview.targetSessionFile) throw new Error("Expected persisted preview");
	await writeFile(preview.targetSessionFile, "occupied\n");
	await expect(h.manager.newSession(undefined, preview)).rejects.toThrow("no overwrite is allowed");
	expect(h.manager.getSessionId()).toBe(sourceId);
	expect(await readFile(preview.targetSessionFile, "utf8")).toBe("occupied\n");
});
