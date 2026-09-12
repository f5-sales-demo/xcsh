import { afterEach, beforeAll, expect, test, vi } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { CommandController } from "../../../src/modes/controllers/command-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import type { HandoffResult } from "../../../src/session/agent-session";
import { SessionManager, type SessionNewPreview } from "../../../src/session/session-manager";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
const directories: string[] = [];
afterEach(async () => {
	for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

async function harness(options: { failAfterCreate?: boolean } = {}) {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-handoff-review-"));
	directories.push(dir);
	const manager = SessionManager.create(dir, dir);
	manager.appendMessage({ role: "user", content: "Synthetic request", timestamp: 1 });
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "Synthetic response" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "fixture-model",
		stopReason: "stop",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp: 2,
	});
	await manager.ensureOnDisk();
	await manager.flush();
	const sourceFile = manager.getSessionFile()!;
	const sourceBytes = await readFile(sourceFile, "utf8");
	let pendingPreview: SessionNewPreview | undefined;
	let failed = false;
	const handoff = vi.fn(
		async (
			_customInstructions?: string,
			handoffOptions?: { signal?: AbortSignal; newSessionPreview?: SessionNewPreview },
		): Promise<HandoffResult> => {
			const preview = handoffOptions?.newSessionPreview;
			if (!preview) throw new Error("Expected reviewed preview");
			if (!pendingPreview) {
				await manager.newSession(undefined, preview);
				manager.appendCustomMessageEntry("handoff", "<handoff-context>fixture</handoff-context>", true);
				pendingPreview = preview;
				if (options.failAfterCreate && !failed) {
					failed = true;
					throw new Error("Fixture local persistence failure");
				}
			}
			await manager.retryPersistence();
			pendingPreview = undefined;
			return { document: "fixture" };
		},
	);
	let component: Component;
	const container = { clear: vi.fn(), addChild: vi.fn() };
	const session = {
		model: { provider: "anthropic", id: "fixture-model" },
		getAsyncJobSnapshot: () => ({ running: [], recent: [] }),
		getPendingReviewedHandoffPreview: () => pendingPreview,
		hasPendingReviewedHandoff: (preview: SessionNewPreview) =>
			pendingPreview?.targetSessionId === preview.targetSessionId,
		handoff,
	};
	const ctx = {
		sessionManager: manager,
		session,
		chatContainer: container,
		statusContainer: container,
		statusLine: { invalidate() {} },
		ui: { terminal: { rows: 24 }, requestRender() {} },
		updateEditorTopBorder() {},
		updateEditorBorderColor() {},
		rebuildChatFromMessages: vi.fn(),
		reloadTodos: vi.fn(async () => {}),
		showStatus: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				component = factory(ctx.ui, {}, {}, resolve);
			}),
	} as unknown as InteractiveModeContext;
	return {
		controller: new CommandController(ctx),
		ctx,
		manager,
		handoff,
		sourceFile,
		sourceBytes,
		input: (data: string) => component.handleInput?.(data),
		text: () => Bun.stripANSI(component.render(100).join("\n")),
	};
}

async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 300; i++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Expected dialog state missing");
}

test("handoff review names the exact destination and cancellation preserves the source", async () => {
	const h = await harness();
	const sourceId = h.manager.getSessionId();
	const operation = h.controller.handleHandoffCommand("Focus on tests");
	const review = h.text();
	expect(review).toContain("Review session handoff");
	expect(review).toContain(sourceId);
	expect(review).toContain("Focus on tests");
	expect(review).toContain("Cancel");
	h.input("\r");
	await operation;
	expect(h.handoff).not.toHaveBeenCalled();
	expect(h.manager.getSessionId()).toBe(sourceId);
	expect(await readFile(h.sourceFile, "utf8")).toBe(h.sourceBytes);
});

test("confirmed handoff creates and verifies the reviewed destination", async () => {
	const h = await harness();
	const operation = h.controller.handleHandoffCommand();
	const targetId = h.text().match(/Active session: .* → ([a-z0-9]+)/)?.[1];
	expect(targetId).toBeDefined();
	if (!targetId) throw new Error("Expected reviewed handoff destination");
	h.input("\x1b[B");
	h.input("\r");
	await operation;
	expect(h.handoff).toHaveBeenCalledTimes(1);
	expect(h.manager.getSessionId()).toBe(targetId);
	expect((await SessionManager.open(h.manager.getSessionFile()!)).getSessionId()).toBe(targetId);
	expect(await readFile(h.sourceFile, "utf8")).toBe(h.sourceBytes);
});

test("a partial handoff retries the generated transition without generating a second destination", async () => {
	const h = await harness({ failAfterCreate: true });
	const first = h.controller.handleHandoffCommand();
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("Fixture local persistence failure"));
	const createdId = h.manager.getSessionId();
	h.input("\r");
	await first;
	const second = h.controller.handleHandoffCommand();
	expect(h.text()).toContain("Document already generated");
	h.input("\x1b[B");
	h.input("\r");
	await second;
	expect(h.handoff).toHaveBeenCalledTimes(2);
	expect(h.manager.getSessionId()).toBe(createdId);
	expect(h.manager.getEntries().filter(entry => entry.type === "custom_message")).toHaveLength(1);
});
