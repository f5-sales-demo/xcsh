import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import type { TUI } from "@f5-sales-demo/pi-tui";
import { HookInputComponent } from "../src/modes/components/hook-input";
import { getThemeByName, setThemeInstance } from "../src/modes/theme/theme";

beforeAll(async () => {
	const theme = await getThemeByName("xcsh-dark");
	if (!theme) {
		throw new Error("Failed to load dark theme for tests");
	}
	setThemeInstance(theme);
});
describe("HookInputComponent timeout", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("resets timeout on user activity and still expires when idle", () => {
		vi.useFakeTimers();

		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const onTimeout = vi.fn();
		const tui = { requestRender: vi.fn() } as unknown as TUI;

		const component = new HookInputComponent("Prompt", undefined, onSubmit, onCancel, {
			timeout: 1_000,
			tui,
			onTimeout,
		});

		vi.advanceTimersByTime(900);
		component.handleInput("a");

		vi.advanceTimersByTime(900);
		component.handleInput("\x7f");

		vi.advanceTimersByTime(900);
		expect(onTimeout).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();

		vi.advanceTimersByTime(200);
		expect(onTimeout).toHaveBeenCalledTimes(1);
		expect(onCancel).toHaveBeenCalledTimes(1);

		component.dispose();
	});

	it("preserves submit behavior", () => {
		vi.useFakeTimers();

		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const onTimeout = vi.fn();
		const tui = { requestRender: vi.fn() } as unknown as TUI;

		const component = new HookInputComponent("Prompt", undefined, onSubmit, onCancel, {
			timeout: 1_000,
			tui,
			onTimeout,
		});

		component.handleInput("h");
		component.handleInput("i");
		component.handleInput("\n");
		component.handleInput("\n");
		vi.advanceTimersByTime(2000);

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("hi");
		expect(onCancel).not.toHaveBeenCalled();
		expect(onTimeout).not.toHaveBeenCalled();

		component.dispose();
	});
	it("Escape cancels input but Ctrl+C does not close it", () => {
		const cancelled = vi.fn();
		const component = new HookInputComponent("Prompt", "Example", vi.fn(), cancelled);
		component.handleInput("\x03");
		expect(cancelled).not.toHaveBeenCalled();
		component.handleInput("\x1b");
		expect(cancelled).toHaveBeenCalledTimes(1);
	});
});
