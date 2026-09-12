import { afterEach, beforeAll, expect, test, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { Settings } from "../../../src/config/settings";
import type { TreeSelectorComponent } from "../../../src/modes/components/tree-selector";
import { SelectorController } from "../../../src/modes/controllers/selector-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import { SessionManager } from "../../../src/session/session-manager";

beforeAll(async () => {
	setThemeInstance((await getThemeByName("xcsh-dark"))!);
	await Settings.init({ inMemory: true, cwd: tmpdir() });
});
const directories: string[] = [];
afterEach(async () => {
	for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

async function harness(options: { failAfterMove?: boolean } = {}) {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-tree-review-"));
	directories.push(dir);
	const manager = SessionManager.create(dir, dir);
	const root = manager.appendMessage({ role: "user", content: "Root request", timestamp: 1 });
	const firstAssistant = manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "First response" }],
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
	const target = manager.appendMessage({ role: "user", content: "Editable branch request", timestamp: 3 });
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "Current response" }],
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
		timestamp: 4,
	});
	await manager.ensureOnDisk();
	await manager.flush();
	let pending = false;
	let failed = false;
	const navigateTree = vi.fn(async (_entryId: string) => {
		if (!pending) {
			manager.branch(firstAssistant);
			pending = true;
			if (options.failAfterMove && !failed) {
				failed = true;
				throw new Error("Fixture restoration failure");
			}
		}
		pending = false;
		return { editorText: "Editable branch request", cancelled: false };
	});
	const editor = {
		text: "",
		getText() {
			return this.text;
		},
		setText(value: string) {
			this.text = value;
		},
	};
	let inline: Component;
	let review: Component | undefined;
	const editorContainer = {
		clear() {},
		addChild(component: Component) {
			inline = component;
		},
	};
	const session = {
		model: { provider: "anthropic", id: "fixture-model" },
		hasPendingReviewedTreeNavigation: (entryId: string) => pending && entryId === target,
		navigateTree,
	};
	const ctx = {
		sessionManager: manager,
		session,
		editor,
		editorContainer,
		chatContainer: { clear: vi.fn() },
		statusContainer: { clear() {}, addChild() {} },
		ui: { terminal: { rows: 24 }, setFocus() {}, requestRender() {} },
		renderInitialMessages: vi.fn(),
		reloadTodos: vi.fn(async () => {}),
		showStatus: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn(),
		showHookSelector: vi.fn(async () => "Navigate without summary"),
		showHookEditor: vi.fn(async () => undefined),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				review = factory(ctx.ui, {}, {}, resolve);
			}),
	} as unknown as InteractiveModeContext;
	const controller = new SelectorController(ctx);
	controller.showTreeSelector();
	const tree = () => inline as TreeSelectorComponent;
	const openTarget = () => {
		tree().handleInput("\x1b[A");
		expect(tree().getSelectedNode()?.entry.id).toBe(target);
		tree().handleInput("\r");
		tree().handleInput("\r");
	};
	return {
		ctx,
		manager,
		navigateTree,
		root,
		target,
		tree,
		openTarget,
		review: () => review,
		reviewText: () => Bun.stripANSI(review?.render(100).join("\n") ?? ""),
	};
}

async function waitFor(predicate: () => boolean) {
	for (let index = 0; index < 300; index++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Expected tree review state missing");
}

test("tree navigation cancellation retains the exact source leaf and parent selector", async () => {
	const h = await harness();
	const sourceLeaf = h.manager.getLeafId();
	h.openTarget();
	await waitFor(() => h.reviewText().includes("Review tree navigation"));
	expect(h.reviewText()).toContain(h.target);
	h.review()!.handleInput?.("\r");
	await Bun.sleep(1);
	expect(h.navigateTree).not.toHaveBeenCalled();
	expect(h.manager.getLeafId()).toBe(sourceLeaf);
	expect(Bun.stripANSI(h.tree().render(80).join("\n"))).toContain("Tree node details");
});

test("confirmed tree navigation verifies the destination and prefills an empty editor", async () => {
	const h = await harness();
	h.openTarget();
	await waitFor(() => h.reviewText().includes("Review tree navigation"));
	h.review()!.handleInput?.("\x1b[B");
	h.review()!.handleInput?.("\r");
	await waitFor(() => h.navigateTree.mock.calls.length === 1);
	expect(h.manager.getLeafId()).not.toBe(h.target);
	expect((h.ctx.editor as unknown as { text: string }).text).toBe("Editable branch request");
	expect(h.ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining(h.target));
});

test("partial tree navigation retries only restoration after renewing the changed review", async () => {
	const h = await harness({ failAfterMove: true });
	h.openTarget();
	await waitFor(() => h.reviewText().includes("Review tree navigation"));
	h.review()!.handleInput?.("\x1b[B");
	h.review()!.handleInput?.("\r");
	await waitFor(() => h.reviewText().includes("Fixture restoration failure"));
	const appliedLeaf = h.manager.getLeafId();
	h.review()!.handleInput?.("\x1b[B");
	h.review()!.handleInput?.("\r");
	await waitFor(() => h.reviewText().includes("proposal changed"));
	expect(h.navigateTree).toHaveBeenCalledTimes(1);
	h.review()!.handleInput?.("\x1b[B");
	h.review()!.handleInput?.("\r");
	await waitFor(() => h.navigateTree.mock.calls.length === 2);
	expect(h.manager.getLeafId()).toBe(appliedLeaf);
});
