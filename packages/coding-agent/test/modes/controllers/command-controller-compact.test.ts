import { beforeAll, expect, test, vi } from "bun:test";
import type { Component } from "@f5-sales-demo/pi-tui";
import { CommandController } from "../../../src/modes/controllers/command-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

function createHarness() {
	let leafId = "assistant-1";
	const entries: Array<Record<string, unknown>> = [
		{ type: "message", id: "user-1", parentId: null },
		{ type: "message", id: leafId, parentId: "user-1" },
	];
	let component: Component | undefined;
	let resolveDialog: ((value: unknown) => void) | undefined;
	const compact = vi.fn(async () => {
		leafId = "compaction-1";
		entries.push({ type: "compaction", id: leafId, parentId: "assistant-1" });
	});
	const retryPersistence = vi.fn(async () => {});
	const abortCompaction = vi.fn();
	const session = {
		model: { provider: "synthetic", id: "compact-model" },
		isStreaming: false,
		isCompacting: false,
		compact,
		abortCompaction,
	};
	const manager = {
		getEntries: () => entries,
		getLeafId: () => leafId,
		getSessionId: () => "synthetic-session",
		retryPersistence,
	};
	const ctx = {
		session,
		sessionManager: manager,
		statusContainer: { clear: vi.fn(), addChild: vi.fn() },
		chatContainer: { addChild: vi.fn() },
		editor: { onEscape: vi.fn() },
		ui: { terminal: { rows: 24 }, requestRender: vi.fn() },
		showStatus: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn(),
		rebuildChatFromMessages: vi.fn(),
		statusLine: { invalidate: vi.fn() },
		updateEditorTopBorder: vi.fn(),
		flushCompactionQueue: vi.fn(async () => {}),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				resolveDialog = resolve;
				component = factory(ctx.ui, {}, {}, resolve);
			}),
	} as unknown as InteractiveModeContext;
	return {
		ctx,
		session,
		manager,
		entries,
		compact,
		retryPersistence,
		abortCompaction,
		controller: new CommandController(ctx),
		get component() {
			return component;
		},
		close(value: unknown = "cancelled") {
			resolveDialog?.(value);
		},
	};
}

async function waitForComponent(harness: ReturnType<typeof createHarness>): Promise<Component> {
	for (let attempt = 0; attempt < 100 && !harness.component; attempt++) await Bun.sleep(1);
	if (!harness.component) throw new Error("Compaction review did not open");
	return harness.component;
}

test("manual compaction is Cancel-first and saves only after the reviewed model operation", async () => {
	const harness = createHarness();
	let pending = harness.controller.handleCompactCommand("Preserve synthetic decisions");
	let component = await waitForComponent(harness);
	const review = Bun.stripANSI(component.render(100).join("\n"));
	expect(review).toContain("Review session compaction");
	expect(review).toContain("Current session synthetic-session");
	expect(review).toContain("synthetic/compact-model");
	expect(review).toContain("Preserve synthetic decisions");
	component.handleInput?.("\r");
	await pending;
	expect(harness.compact).not.toHaveBeenCalled();
	expect(harness.retryPersistence).not.toHaveBeenCalled();

	pending = harness.controller.handleCompactCommand("Preserve synthetic decisions");
	component = await waitForComponent(harness);
	component.handleInput?.("\x1b[B");
	component.handleInput?.("\r");
	await pending;
	expect(harness.compact).toHaveBeenCalledTimes(1);
	expect(harness.compact).toHaveBeenCalledWith("Preserve synthetic decisions", undefined);
	expect(harness.retryPersistence).toHaveBeenCalledTimes(1);
	expect(harness.ctx.showStatus).toHaveBeenCalledWith("Session context compacted and saved.");
	await harness.controller.handleCompactCommand();
	expect(harness.compact).toHaveBeenCalledTimes(1);
	expect(harness.retryPersistence).toHaveBeenCalledTimes(1);
	expect(harness.ctx.showWarning).toHaveBeenCalledWith("Session is already compacted; nothing changed.");
});

test("changed history requires renewed review before manual compaction", async () => {
	const harness = createHarness();
	const pending = harness.controller.handleCompactCommand();
	const component = await waitForComponent(harness);
	harness.entries.push({ type: "message", id: "concurrent", parentId: "assistant-1" });
	(harness.manager.getLeafId as () => string) = () => "concurrent";
	component.handleInput?.("\x1b[B");
	component.handleInput?.("\r");
	await Bun.sleep(5);
	expect(Bun.stripANSI(component.render(100).join("\n"))).toContain("The proposal changed");
	expect(harness.compact).not.toHaveBeenCalled();
	component.handleInput?.("\r");
	await pending;
});

test("a failed backing save retries persistence without compacting twice", async () => {
	const harness = createHarness();
	harness.retryPersistence.mockRejectedValueOnce(new Error("synthetic fsync failure"));
	let pending = harness.controller.handleCompactCommand();
	let component = await waitForComponent(harness);
	component.handleInput?.("\x1b[B");
	component.handleInput?.("\r");
	for (let attempt = 0; attempt < 100; attempt++) {
		if (Bun.stripANSI(component.render(100).join("\n")).includes("synthetic fsync failure")) break;
		await Bun.sleep(1);
	}
	expect(Bun.stripANSI(component.render(100).join("\n"))).toContain("synthetic fsync failure");
	component.handleInput?.("\r");
	await pending;
	expect(harness.compact).toHaveBeenCalledTimes(1);
	expect(harness.ctx.showError).toHaveBeenCalledWith(expect.stringContaining("Compaction is unresolved"));

	pending = harness.controller.handleCompactCommand("A different request must not repeat compaction");
	component = await waitForComponent(harness);
	const recovery = Bun.stripANSI(component.render(100).join("\n"));
	expect(recovery).toContain("backing save unresolved");
	expect(recovery).toContain("without another model call");
	component.handleInput?.("\x1b[B");
	component.handleInput?.("\r");
	await pending;
	expect(harness.compact).toHaveBeenCalledTimes(1);
	expect(harness.retryPersistence).toHaveBeenCalledTimes(2);
});

test("Escape does not interrupt running compaction while Ctrl+C requests and awaits it", async () => {
	const harness = createHarness();
	let rejectCompaction: ((error: Error) => void) | undefined;
	harness.compact.mockImplementation(
		() =>
			new Promise((_resolve, reject) => {
				rejectCompaction = reject;
			}),
	);
	harness.session.isCompacting = true;
	harness.abortCompaction.mockImplementation(() => {
		harness.session.isCompacting = false;
		rejectCompaction?.(new Error("Compaction cancelled"));
	});
	const pending = harness.controller.handleCompactCommand();
	const component = await waitForComponent(harness);
	component.handleInput?.("\x1b[B");
	component.handleInput?.("\r");
	await Bun.sleep(5);
	component.handleInput?.("\x1b");
	expect(harness.abortCompaction).not.toHaveBeenCalled();
	component.handleInput?.("\x03");
	await pending;
	expect(harness.abortCompaction).toHaveBeenCalledTimes(1);
	expect(harness.retryPersistence).not.toHaveBeenCalled();
	expect(harness.ctx.showWarning).toHaveBeenCalledWith("Compaction interrupted; no summary was saved.");
});

test("manual compaction with fewer than two messages performs no review or mutation", async () => {
	const harness = createHarness();
	harness.entries.splice(1);
	await harness.controller.handleCompactCommand();
	expect(harness.compact).not.toHaveBeenCalled();
	expect(harness.retryPersistence).not.toHaveBeenCalled();
	expect(harness.ctx.showWarning).toHaveBeenCalledWith("Nothing to compact (fewer than two messages)");
});
