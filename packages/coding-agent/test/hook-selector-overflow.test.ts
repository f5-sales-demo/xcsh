import { beforeAll, describe, expect, it, vi } from "bun:test";
import { getKeybindings, parseSgrMouse, setKeybindings, visibleWidth } from "@f5-sales-demo/pi-tui";
import { KeybindingsManager } from "../src/config/keybindings";
import { HookSelectorComponent } from "../src/modes/components/hook-selector";
import { ExtensionUiController } from "../src/modes/controllers/extension-ui-controller";
import { getThemeByName, setThemeInstance } from "../src/modes/theme/theme";
import type { InteractiveModeContext } from "../src/modes/types";

beforeAll(async () => {
	const theme = await getThemeByName("xcsh-dark");
	if (!theme) {
		throw new Error("Failed to load dark theme for tests");
	}
	setThemeInstance(theme);
});
describe("HookSelectorComponent", () => {
	it("overflow paging navigates options with configured bindings and contextual hints", () => {
		const original = getKeybindings();
		const keys = KeybindingsManager.inMemory();
		keys.setUserBindings({ "tui.select.pageDown": "ctrl+n", "tui.select.pageUp": "ctrl+p" });
		setKeybindings(keys);
		try {
			const selected = vi.fn();
			const component = new HookSelectorComponent(
				"Pick",
				Array.from({ length: 30 }, (_, i) => `Option ${i}`),
				selected,
				vi.fn(),
				{
					maxVisible: 5,
				},
			);
			expect(Bun.stripANSI(component.render(60).join("\n"))).toContain("Ctrl+P/Ctrl+N: options");
			component.handleInput("\x0e");
			component.handleInput("\x0e");
			component.handleInput("\x10");
			component.handleInput("\r");
			expect(selected).toHaveBeenCalledWith("Option 5");
			const short = new HookSelectorComponent("Pick", ["One"], vi.fn(), vi.fn());
			expect(Bun.stripANSI(short.render(60).join("\n"))).not.toContain(": options");
			const long = new HookSelectorComponent("Pick", [`${"word ".repeat(200)}TAIL`], vi.fn(), vi.fn());
			expect(Bun.stripANSI(long.render(60).join("\n"))).toContain("Ctrl+P/Ctrl+N: details");
			for (let i = 0; i < 30; i++) long.handleInput("\x0e");
			expect(Bun.stripANSI(long.render(60).join("\n"))).toContain("TAIL");
			for (let i = 0; i < 30; i++) long.handleInput("\x10");
			expect(Bun.stripANSI(long.render(60).join("\n"))).not.toContain("TAIL");
		} finally {
			setKeybindings(original);
		}
	});
	it("wheel navigation changes selection without activating it", () => {
		const selected = vi.fn();
		const component = new HookSelectorComponent("Pick", ["First", "Second"], selected, vi.fn());
		component.routeMouse(parseSgrMouse("\x1b[<65;4;8M")!, 7, 3);
		expect(selected).not.toHaveBeenCalled();
		component.handleInput("\r");
		expect(selected).toHaveBeenCalledWith("Second");
		component.routeMouse(parseSgrMouse("\x1b[<64;4;8M")!, 7, 3);
		component.handleInput("\r");
		expect(selected).toHaveBeenCalledTimes(1);
	});
	it("clicking a visible row activates that exact option", () => {
		const selected = vi.fn();
		const component = new HookSelectorComponent("Pick", ["First", "Second"], selected, vi.fn());
		const lines = component.render(60);
		const row = lines.findIndex(line => Bun.stripANSI(line).includes("Second"));
		expect(row).toBeGreaterThan(0);
		component.routeMouse(parseSgrMouse(`\x1b[<0;4;${row + 1}M`)!, row, 3);
		expect(selected).toHaveBeenCalledWith("Second");
	});
	it("short options are not repeated as details, while clipped options remain reachable", () => {
		const short = new HookSelectorComponent("Queue", ["Cancel", "Read"], vi.fn(), vi.fn());
		expect(Bun.stripANSI(short.render(60).join("\n")).match(/Cancel/g)).toHaveLength(1);
		const long = new HookSelectorComponent("Queue", [`Long option ${"word ".repeat(40)}TAIL`], vi.fn(), vi.fn());
		long.render(60);
		for (let i = 0; i < 20; i++) long.handleInput("\x1b[6~");
		expect(Bun.stripANSI(long.render(60).join("\n"))).toContain("TAIL");
	});
	it("selector overlay preserves editor content and settles exactly once on external close or abort", async () => {
		const hide = vi.fn();
		const showOverlay = vi.fn(() => ({ hide }));
		const ctx = {
			ui: { terminal: { rows: 24 }, requestRender: vi.fn(), setFocus: vi.fn(), showOverlay },
			editor: {},
			editorContainer: { clear: vi.fn(), addChild: vi.fn() },
			session: { notifyUserPrompt: vi.fn() },
		} as unknown as InteractiveModeContext;
		const controller = new ExtensionUiController(ctx);
		const abort = new AbortController();
		const pending = controller.showHookSelector("First", ["Keep", "Change"], { signal: abort.signal });
		const first = ctx.hookSelector;
		expect(showOverlay).toHaveBeenCalledWith(first, { fullscreen: true, mouseTracking: true });
		expect(ctx.editorContainer.clear).not.toHaveBeenCalled();
		expect(await controller.showHookSelector("Duplicate", ["Other"])).toBeUndefined();
		expect(ctx.hookSelector).toBe(first);
		controller.hideHookSelector();
		expect(await pending).toBeUndefined();
		expect(hide).toHaveBeenCalledTimes(1);
		const next = controller.showHookSelector("Next", ["Keep"]);
		abort.abort();
		expect(hide).toHaveBeenCalledTimes(1);
		ctx.hookSelector!.handleInput("\r");
		expect(await next).toBe("Keep");
		expect(hide).toHaveBeenCalledTimes(2);
		expect(ctx.editorContainer.addChild).not.toHaveBeenCalled();
	});
	it("shared selection does not mislabel built-in callers as extensions", () => {
		const component = new HookSelectorComponent(
			"Queue a forced tool call",
			["Cancel", "Queue forced tool: read"],
			vi.fn(),
			vi.fn(),
		);
		const rendered = Bun.stripANSI(component.render(60).join("\n"));
		expect(rendered).toContain("Choose an option");
		expect(rendered).toContain("Queue a forced tool call");
		expect(rendered).not.toContain("Extension selection");
	});
	it("extension confirmation starts on No and returns Yes only after explicit selection", async () => {
		const notifyUserPrompt = vi.fn();
		const ctx = {
			ui: { terminal: { rows: 24 }, requestRender() {}, setFocus() {}, showOverlay: () => ({ hide() {} }) },
			editor: {},
			editorContainer: { clear() {}, addChild() {} },
			session: { notifyUserPrompt },
		} as unknown as InteractiveModeContext;
		const controller = new ExtensionUiController(ctx);
		const cancelled = controller.showHookConfirm("Change?", "Synthetic target only.");
		ctx.hookSelector!.handleInput("\r");
		expect(await cancelled).toBe(false);
		const accepted = controller.showHookConfirm("Change?", "Synthetic target only.");
		ctx.hookSelector!.handleInput("\x1b[B");
		ctx.hookSelector!.handleInput("\r");
		expect(await accepted).toBe(true);
		expect(notifyUserPrompt.mock.calls).toEqual([
			["start", "confirm"],
			["end", "confirm"],
			["start", "confirm"],
			["end", "confirm"],
		]);
	});
	it("extension confirmation forwards cancellation options and fails closed on abort", async () => {
		const notifyUserPrompt = vi.fn();
		const ctx = {
			ui: { terminal: { rows: 24 }, requestRender() {}, setFocus() {}, showOverlay: () => ({ hide() {} }) },
			editor: {},
			editorContainer: { clear() {}, addChild() {} },
			session: { notifyUserPrompt },
		} as unknown as InteractiveModeContext;
		const controller = new ExtensionUiController(ctx);
		const abort = new AbortController();
		const pending = controller.showHookConfirm("Change?", "Synthetic target only.", { signal: abort.signal });
		abort.abort();
		expect(await pending).toBe(false);
		expect(notifyUserPrompt.mock.calls).toEqual([
			["start", "confirm"],
			["end", "confirm"],
		]);
	});
	it("search accepts printable navigation letters and Escape restores the original selection", () => {
		const selected = vi.fn();
		const cancelled = vi.fn();
		const component = new HookSelectorComponent("Choose", ["First", "Jupiter", "Third"], selected, cancelled, {
			initialIndex: 2,
		});
		component.handleInput("j");
		expect(Bun.stripANSI(component.render(80).join("\n"))).toContain("1 of 3 options");
		component.handleInput("\x1b");
		expect(cancelled).not.toHaveBeenCalled();
		component.handleInput("\r");
		component.handleInput("\r");
		expect(selected).toHaveBeenCalledTimes(1);
		expect(selected).toHaveBeenCalledWith("Third");
	});
	it("timeout cancels rather than activating an option", () => {
		vi.useFakeTimers();
		const selected = vi.fn();
		const cancelled = vi.fn();
		const component = new HookSelectorComponent("Review", ["Delete", "Keep"], selected, cancelled, {
			timeout: 1000,
			tui: { requestRender() {} } as never,
		});
		try {
			vi.advanceTimersByTime(1001);
			expect(selected).not.toHaveBeenCalled();
			expect(cancelled).toHaveBeenCalledTimes(1);
			component.handleInput("\r");
			expect(selected).not.toHaveBeenCalled();
		} finally {
			component.dispose();
			vi.useRealTimers();
		}
	});
	it("empty search results cannot activate an option and Ctrl+C is not Back", () => {
		const selected = vi.fn();
		const cancelled = vi.fn();
		const component = new HookSelectorComponent("Choose", ["First"], selected, cancelled);
		component.handleInput("missing");
		component.handleInput("\r");
		component.handleInput("\x03");
		expect(selected).not.toHaveBeenCalled();
		expect(cancelled).not.toHaveBeenCalled();
		expect(Bun.stripANSI(component.render(60).join("\n"))).toContain("No matching options");
	});
	it("keeps outlined options within render width", () => {
		const options = [
			"aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;b",
			"bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;aaa;bbb;a",
			"a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b;a;b",
		];
		const component = new HookSelectorComponent(
			"Which pattern do you prefer?",
			options,
			() => {},
			() => {},
			{ outline: true, initialIndex: 0 },
		);

		const width = 80;
		const lines = component.render(width);
		for (const line of lines) {
			expect(visibleWidth(Bun.stripANSI(line))).toBeLessThanOrEqual(width);
		}
	});
});
