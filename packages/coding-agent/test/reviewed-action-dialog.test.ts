import { afterEach, beforeAll, expect, test, vi } from "bun:test";
import { type Component, getKeybindings, setKeybindings } from "@f5-sales-demo/pi-tui";
import { KeybindingsManager } from "../src/config/keybindings";
import type { ActionReview } from "../src/modes/components/reviewed-action";
import {
	ActionInterruptedError,
	ReviewedActionDialog,
	runReviewedAction,
} from "../src/modes/components/reviewed-action-dialog";
import { ExtensionUiController } from "../src/modes/controllers/extension-ui-controller";
import { getThemeByName, setThemeInstance, theme } from "../src/modes/theme/theme";
import type { InteractiveModeContext } from "../src/modes/types";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
const originalKeys = getKeybindings();
afterEach(() => setKeybindings(originalKeys));
const review: ActionReview = {
	identity: "session:fixture",
	scope: "Current session",
	revision: "off",
	changes: [{ field: "Fast mode", before: "off", after: "on" }],
	consequence: "Priority requests may cost more.",
};
test("overflow reviews advertise and use configured paging keys only when needed", () => {
	const keys = KeybindingsManager.inMemory();
	keys.setUserBindings({ "tui.select.pageDown": "ctrl+n", "tui.select.pageUp": "ctrl+p" });
	setKeybindings(keys);
	const longReview = {
		...review,
		changes: Array.from({ length: 18 }, (_, i) => ({ field: `Field ${i}`, before: "old", after: "new" })),
	};
	const dialog = new ReviewedActionDialog(
		"bulk change",
		{
			review: longReview,
			resolve: async () => ({ review: longReview, target: true }),
			execute: async () => {},
		},
		() => {},
		() => {},
		() => 20,
	);
	const initial = Bun.stripANSI(dialog.render(80).join("\n"));
	expect(initial).toContain("Ctrl+P/Ctrl+N: review details");
	expect(initial).not.toContain("PgUp/PgDn");
	dialog.handleInput("\x0e");
	const paged = Bun.stripANSI(dialog.render(80).join("\n"));
	expect(paged).not.toContain("Target: session:fixture");
	expect(paged).toContain("Field 8: old → new");
	dialog.handleInput("\x10");
	expect(Bun.stripANSI(dialog.render(80).join("\n"))).toEqual(initial);
	const short = new ReviewedActionDialog(
		"mode",
		{ review, resolve: async () => ({ review, target: true }), execute: async () => {} },
		() => {},
		() => {},
		() => 32,
	);
	expect(Bun.stripANSI(short.render(80).join("\n"))).not.toContain("review details");
});
test("custom dialog factory failures reject without changing the draft", async () => {
	const ctx = {
		ui: { requestRender: vi.fn(), setFocus: vi.fn() },
		editor: { getText: () => "retained draft", setText: vi.fn() },
		editorContainer: { clear: vi.fn(), addChild: vi.fn() },
	} as unknown as InteractiveModeContext;
	const controller = new ExtensionUiController(ctx);
	for (const factory of [
		() => {
			throw new Error("factory failed");
		},
		async () => {
			throw new Error("factory failed");
		},
	]) {
		await expect(controller.showHookCustom(factory)).rejects.toThrow("factory failed");
	}
	expect(ctx.editorContainer.clear).not.toHaveBeenCalled();
	expect(ctx.editor.setText).not.toHaveBeenCalled();
}, 1000);

test("custom dialog cleanup failure still hides the overlay and rejects", async () => {
	let close: ((value: boolean) => void) | undefined;
	const hide = vi.fn();
	const ctx = {
		ui: { showOverlay: vi.fn(() => ({ hide })), requestRender: vi.fn(), setFocus: vi.fn() },
		editor: { getText: () => "retained draft" },
	} as unknown as InteractiveModeContext;
	const controller = new ExtensionUiController(ctx);
	const pending = controller.showHookCustom<boolean>(
		(_ui, _theme, _keys, done) => {
			close = done;
			return {
				render: () => [],
				invalidate() {},
				dispose: () => {
					throw new Error("dispose failed");
				},
			};
		},
		{ overlay: true, fullscreen: true },
	);
	await Bun.sleep(0);
	close!(true);
	await expect(pending).rejects.toThrow("dispose failed");
	expect(hide).toHaveBeenCalledTimes(1);
});

test("failed review presentation releases the execution guard for another attempt", async () => {
	let component: Component | undefined;
	const showOverlay = vi.fn((_value: Component): { hide(): void } => {
		throw new Error("overlay failed");
	});
	const ctx = {
		ui: { terminal: { rows: 24 }, showOverlay, requestRender: vi.fn(), setFocus: vi.fn() },
		editor: { getText: () => "retained draft" },
	} as unknown as InteractiveModeContext;
	const controller = new ExtensionUiController(ctx);
	ctx.showHookCustom = controller.showHookCustom.bind(controller);
	const action = { review, resolve: async () => ({ review, target: true }), execute: vi.fn(async () => {}) };
	await expect(runReviewedAction(ctx, "mode", action)).rejects.toThrow("overlay failed");
	showOverlay.mockImplementation(value => {
		component = value;
		return { hide() {} };
	});
	const retry = runReviewedAction(ctx, "mode", action);
	await Bun.sleep(0);
	expect(component).toBeDefined();
	component!.handleInput!("\r");
	expect(await retry).toBe("cancelled");
	expect(action.execute).not.toHaveBeenCalled();
});

test("shared reviews use a fullscreen overlay without replacing the draft or transcript", async () => {
	let component: Component | undefined;
	const hide = vi.fn();
	const showOverlay = vi.fn((value: Component) => {
		component = value;
		return { hide };
	});
	const ctx = {
		ui: { terminal: { rows: 24 }, showOverlay, requestRender() {}, setFocus: vi.fn() },
		editor: { getText: () => "retained draft", setText: vi.fn() },
		editorContainer: { clear: vi.fn(), addChild: vi.fn() },
	} as unknown as InteractiveModeContext;
	const controller = new ExtensionUiController(ctx);
	ctx.showHookCustom = controller.showHookCustom.bind(controller);
	const pending = runReviewedAction(ctx, "mode", {
		review,
		resolve: async () => ({ review, target: true }),
		execute: async () => {},
	});
	for (let i = 0; i < 100 && !component; i++) await Bun.sleep(1);
	// Settle even when an implementation incorrectly embeds the review instead of opening an overlay.
	const rendered =
		component ??
		((ctx.editorContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Component | undefined);
	if (rendered) rendered.handleInput?.("\r");
	await pending;
	expect(showOverlay).toHaveBeenCalledWith(expect.anything(), { fullscreen: true });
	expect(hide).toHaveBeenCalledTimes(1);
	expect(ctx.editorContainer.clear).not.toHaveBeenCalled();
	expect(ctx.editor.setText).not.toHaveBeenCalled();
	expect(ctx.ui.setFocus).not.toHaveBeenCalled();
});
test("internal revision snapshots are never rendered as user-facing review content", () => {
	const privateReview = { ...review, revision: JSON.stringify({ internal: "SYNTHETIC_PRIVATE_SNAPSHOT" }) };
	const dialog = new ReviewedActionDialog(
		"mode",
		{
			review: privateReview,
			resolve: async () => ({ review: privateReview, target: true }),
			execute: async () => {},
		},
		() => {},
	);
	const text = Bun.stripANSI(dialog.render(80).join("\n"));
	expect(text).not.toContain("SYNTHETIC_PRIVATE_SNAPSHOT");
	expect(text).toContain("Fast mode: off → on");
	expect(text).toContain("Priority requests may cost more.");
});

test("cooperative interruption honors remaps and waits for explicit acknowledgement", async () => {
	const keys = KeybindingsManager.inMemory();
	keys.setUserBindings({ "app.interrupt": "alt+x" });
	setKeybindings(keys);
	const pending = Promise.withResolvers<void>();
	const done = vi.fn();
	let signal: AbortSignal | undefined;
	const dialog = new ReviewedActionDialog(
		"Work",
		{
			review,
			cancellable: true,
			resolve: async () => ({ review, target: true }),
			execute: async (_target, executionSignal) => {
				signal = executionSignal;
				await pending.promise;
			},
		},
		done,
	);
	dialog.handleInput("\x1b[B");
	dialog.handleInput("\r");
	await Bun.sleep(0);
	dialog.handleInput("\x1b");
	dialog.handleInput("\x03");
	expect(signal?.aborted).toBe(false);
	dialog.handleInput("\x1bx");
	expect(signal?.aborted).toBe(true);
	expect(done).not.toHaveBeenCalled();
	expect(Bun.stripANSI(dialog.render(80).join("\n"))).toContain("waiting for acknowledgement");
	pending.reject(new ActionInterruptedError("Stopped and partial results accounted for."));
	await Bun.sleep(0);
	expect(done).toHaveBeenCalledWith("interrupted");
});

test("an operation finishing normally after interruption request still reports success", async () => {
	const pending = Promise.withResolvers<void>();
	const done = vi.fn();
	const dialog = new ReviewedActionDialog(
		"Work",
		{
			review,
			cancellable: true,
			resolve: async () => ({ review, target: true }),
			execute: async () => pending.promise,
		},
		done,
	);
	dialog.handleInput("\x1b[B");
	dialog.handleInput("\r");
	await Bun.sleep(0);
	dialog.handleInput("\x03");
	pending.resolve();
	await Bun.sleep(0);
	expect(done).toHaveBeenCalledWith("succeeded");
});
test("closing after execution failure reports an unresolved outcome", async () => {
	const done = vi.fn();
	const dialog = new ReviewedActionDialog(
		"Fast mode",
		{
			review,
			resolve: async () => ({ review, target: true }),
			execute: async () => {
				throw new Error("Backing write unavailable");
			},
		},
		done,
	);
	dialog.handleInput("\x1b[B");
	dialog.handleInput("\r");
	await Bun.sleep(0);
	expect(Bun.stripANSI(dialog.render(80).join("\n"))).toContain("Close unresolved result");
	dialog.handleInput("\x1b");
	expect(done).toHaveBeenCalledWith("unresolved");
});

test("shared review defaults to cancel and never executes before explicit confirmation", () => {
	const execute = vi.fn();
	const done = vi.fn();
	const dialog = new ReviewedActionDialog(
		"Fast mode",
		{ review, resolve: async () => ({ review, target: true }), execute },
		done,
	);
	dialog.handleInput("\r");
	expect(execute).not.toHaveBeenCalled();
	expect(done).toHaveBeenCalledWith("cancelled");
});
test("shared review tracks non-cancellable execution and rejects duplicate submission", async () => {
	const pending = Promise.withResolvers<void>();
	const execute = vi.fn(() => pending.promise);
	const done = vi.fn();
	const dialog = new ReviewedActionDialog(
		"Fast mode",
		{ review, resolve: async () => ({ review, target: true }), execute },
		done,
	);
	dialog.handleInput("\x1b[B");
	dialog.handleInput("\r");
	await Bun.sleep(0);
	dialog.handleInput("\r");
	dialog.handleInput("\x1b");
	dialog.handleInput("\x03");
	expect(execute).toHaveBeenCalledTimes(1);
	expect(done).not.toHaveBeenCalled();
	expect(Bun.stripANSI(dialog.render(60).join("\n"))).toContain("in progress");
	pending.resolve();
	await Bun.sleep(0);
	expect(done).toHaveBeenCalledWith("succeeded");
});
test("changed proposals require a renewed cancel-first review", async () => {
	const current = { ...review, revision: "changed", consequence: "Updated consequences." };
	const execute = vi.fn();
	const done = vi.fn();
	const dialog = new ReviewedActionDialog(
		"Fast mode",
		{ review, resolve: async () => ({ review: current, target: true }), execute },
		done,
	);
	dialog.handleInput("\x1b[B");
	dialog.handleInput("\r");
	await Bun.sleep(0);
	expect(execute).not.toHaveBeenCalled();
	expect(Bun.stripANSI(dialog.render(80).join("\n"))).toContain("Updated consequences.");
	dialog.handleInput("\r");
	expect(done).toHaveBeenCalledWith("cancelled");
});

test("renewed proposal warnings remain distinct from execution failures", async () => {
	const current = { ...review, revision: "changed" };
	const dialog = new ReviewedActionDialog(
		"mode",
		{
			review,
			resolve: async () => ({ review: current, target: true }),
			execute: async () => {
				throw new Error("Backing write failed");
			},
		},
		() => {},
	);
	const color = vi.spyOn(theme, "fg");
	try {
		dialog.handleInput("\x1b[B");
		dialog.handleInput("\r");
		await Bun.sleep(0);
		dialog.render(100);
		expect(color).toHaveBeenCalledWith(
			"warning",
			"The proposal changed. Review the updated values before confirming.",
		);
		color.mockClear();
		dialog.handleInput("\x1b[B");
		dialog.handleInput("\r");
		await Bun.sleep(0);
		expect(Bun.stripANSI(dialog.render(100).join("\n"))).toContain("Unresolved mode");
		expect(color).toHaveBeenCalledWith("error", "Backing write failed");
	} finally {
		color.mockRestore();
	}
});
