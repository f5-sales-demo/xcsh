import { afterEach, beforeAll, expect, test, vi } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { SelectorController } from "../../../src/modes/controllers/selector-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import { SessionManager } from "../../../src/session/session-manager";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
const directories: string[] = [];
afterEach(async () => {
	for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

async function harness(options: { failUiOnce?: boolean } = {}) {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-resume-review-"));
	directories.push(dir);
	const source = SessionManager.create(dir, dir);
	source.appendMessage({ role: "user", content: "Source conversation", timestamp: 1 });
	await source.ensureOnDisk();
	await source.flush();
	const sourceId = source.getSessionId();
	const sourceFile = source.getSessionFile()!;
	const sourceBytes = await readFile(sourceFile, "utf8");
	const targetCwd = join(dir, "recorded-target-project");
	const targetManager = SessionManager.create(targetCwd, dir);
	targetManager.appendMessage({ role: "user", content: "Target conversation", timestamp: 2 });
	await targetManager.ensureOnDisk();
	await targetManager.flush();
	const targetFile = targetManager.getSessionFile()!;
	const target = (await SessionManager.list(dir, dir)).find(item => item.path === targetFile)!;
	let review: Component;
	const switchSession = vi.fn(async (path: string) => {
		await source.setSessionFile(path);
		return true;
	});
	let failed = false;
	const reloadTodos = vi.fn(async () => {
		if (options.failUiOnce && !failed) {
			failed = true;
			throw new Error("Fixture todo restoration failure");
		}
	});
	const container = { clear: vi.fn(), addChild: vi.fn() };
	const ctx = {
		sessionManager: source,
		session: { switchSession },
		loadingAnimation: undefined,
		statusContainer: container,
		pendingMessagesContainer: container,
		compactionQueuedMessages: [],
		streamingComponent: undefined,
		streamingMessage: undefined,
		pendingTools: new Map(),
		chatContainer: container,
		statusLine: { invalidate() {}, setSessionStartTime() {} },
		editor: {},
		ui: { terminal: { rows: 24 }, requestRender() {} },
		updateEditorTopBorder() {},
		updateEditorBorderColor() {},
		renderInitialMessages: vi.fn(),
		reloadTodos,
		showStatus: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				review = factory(ctx.ui, {}, {}, resolve);
			}),
	} as unknown as InteractiveModeContext;
	return {
		controller: new SelectorController(ctx),
		ctx,
		source,
		sourceId,
		sourceFile,
		sourceBytes,
		target,
		switchSession,
		reloadTodos,
		review: () => review,
		text: () => Bun.stripANSI(review?.render(100).join("\n") ?? ""),
	};
}

async function waitFor(predicate: () => boolean) {
	for (let index = 0; index < 300; index++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Expected resume review state missing");
}

test("resume review is Cancel-first and leaves the source untouched", async () => {
	const h = await harness();
	const operation = h.controller.handleResumeSession(h.target.path, h.target);
	await waitFor(() => h.text().includes("Review session resume"));
	expect(h.text()).toContain("Review session resume");
	expect(h.text()).toContain(h.target.id);
	expect(h.text()).toContain("Runtime working directory");
	expect(h.text()).toContain("Retained");
	expect(h.text()).toContain("Session's recorded directory");
	h.review().handleInput?.("\r");
	await operation;
	expect(h.switchSession).not.toHaveBeenCalled();
	expect(h.source.getSessionId()).toBe(h.sourceId);
	expect(await readFile(h.sourceFile, "utf8")).toBe(h.sourceBytes);
});

test("confirmed resume loads and independently verifies the exact saved target", async () => {
	const h = await harness();
	const operation = h.controller.handleResumeSession(h.target.path, h.target);
	await waitFor(() => h.text().includes("Review session resume"));
	h.review().handleInput?.("\x1b[B");
	h.review().handleInput?.("\r");
	await operation;
	expect(h.switchSession).toHaveBeenCalledTimes(1);
	expect(h.source.getSessionId()).toBe(h.target.id);
	expect(h.source.getSessionFile()).toBe(h.target.path);
	expect(h.source.getCwd()).not.toBe(h.target.cwd);
	expect(h.ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining(h.target.id));
});

test("resume UI failure retries restoration without switching a second time", async () => {
	const h = await harness({ failUiOnce: true });
	const operation = h.controller.handleResumeSession(h.target.path, h.target);
	await waitFor(() => h.text().includes("Review session resume"));
	h.review().handleInput?.("\x1b[B");
	h.review().handleInput?.("\r");
	await waitFor(() => h.text().includes("Fixture todo restoration failure"));
	h.review().handleInput?.("\x1b[B");
	h.review().handleInput?.("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	h.review().handleInput?.("\x1b[B");
	h.review().handleInput?.("\r");
	await operation;
	expect(h.switchSession).toHaveBeenCalledTimes(1);
	expect(h.reloadTodos).toHaveBeenCalledTimes(2);
	expect(h.source.getSessionId()).toBe(h.target.id);
});
