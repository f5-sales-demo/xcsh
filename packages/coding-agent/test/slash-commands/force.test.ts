import { describe, expect, it, vi } from "bun:test";
import { registerLocales } from "@f5-sales-demo/pi-utils";
import { locales } from "../../src/locales/index";
import type { InteractiveModeContext } from "../../src/modes/types";
import { executeBuiltinSlashCommand } from "../../src/slash-commands/builtin-registry";

registerLocales(locales);

function createRuntimeHarness(overrides?: { setForcedToolChoice?: (toolName: string) => void }) {
	const setForcedToolChoice = vi.fn(overrides?.setForcedToolChoice ?? ((_toolName: string) => {}));
	const setText = vi.fn();
	const showStatus = vi.fn();
	const showError = vi.fn();
	const showHookSelector = vi.fn(async (_title: string, _options: string[]) => undefined as string | undefined);

	const ctx = {
		editor: { setText } as unknown as InteractiveModeContext["editor"],
		session: {
			setForcedToolChoice,
			getActiveToolNames: () => ["write", "read"],
		} as unknown as InteractiveModeContext["session"],
		sessionManager: { getSessionId: () => "session-fixture" },
		showHookSelector,
		showStatus,
		showError,
	} as unknown as InteractiveModeContext;

	return {
		runtime: {
			ctx,
			handleBackgroundCommand: () => {},
		},
		setForcedToolChoice,
		setText,
		showStatus,
		showError,
		showHookSelector,
	};
}

describe("/force slash command", () => {
	it("rejects duplicate choices and a changed session without queueing", async () => {
		const h = createRuntimeHarness();
		const pending = Promise.withResolvers<string | undefined>();
		h.showHookSelector.mockReturnValue(pending.promise);
		const first = executeBuiltinSlashCommand("/force", h.runtime);
		await Bun.sleep(0);
		await executeBuiltinSlashCommand("/force write", h.runtime);
		expect(h.setForcedToolChoice).not.toHaveBeenCalled();
		h.runtime.ctx.sessionManager.getSessionId = () => "other-session";
		pending.resolve("Queue forced tool: write");
		await first;
		expect(h.setForcedToolChoice).not.toHaveBeenCalled();
		expect(h.showError).toHaveBeenCalledWith(expect.stringContaining("Session changed"));
	});
	it("empty active-tool inventory and explicit Cancel leave the queue unchanged", async () => {
		const h = createRuntimeHarness();
		h.showHookSelector.mockResolvedValue("Cancel");
		await executeBuiltinSlashCommand("/force", h.runtime);
		expect(h.setForcedToolChoice).not.toHaveBeenCalled();
		h.runtime.ctx.session.getActiveToolNames = () => [];
		await executeBuiltinSlashCommand("/force", h.runtime);
		expect(h.showHookSelector).toHaveBeenCalledTimes(1);
		expect(h.showStatus).toHaveBeenCalledWith(expect.stringContaining("No active tools"));
		expect(h.setForcedToolChoice).not.toHaveBeenCalled();
	});
	it("forces the next round tool with colon syntax", async () => {
		const harness = createRuntimeHarness();

		const handled = await executeBuiltinSlashCommand("/force:write", harness.runtime);

		expect(handled).toBe(true);
		expect(harness.setForcedToolChoice).toHaveBeenCalledWith("write");
		expect(harness.showStatus).toHaveBeenCalledWith(
			"Queued write once, then no tools. Earlier queued directives may run first; no tool has run yet.",
		);
		expect(harness.showError).not.toHaveBeenCalled();
		expect(harness.setText).toHaveBeenCalledWith("");
	});

	it("offers explicit active-tool choices with Cancel first when no argument is given", async () => {
		const harness = createRuntimeHarness();

		const handled = await executeBuiltinSlashCommand("/force", harness.runtime);

		expect(handled).toBe(true);
		expect(harness.setForcedToolChoice).not.toHaveBeenCalled();
		expect(harness.showError).not.toHaveBeenCalled();
		expect(harness.showHookSelector).toHaveBeenCalledWith(expect.stringContaining("forced tool call"), [
			"Cancel",
			"Queue forced tool: read",
			"Queue forced tool: write",
		]);
		expect(harness.setText).toHaveBeenCalledWith("");
	});
	it("queues an explicitly chosen tool without claiming execution", async () => {
		const harness = createRuntimeHarness();
		harness.showHookSelector.mockResolvedValue("Queue forced tool: write");
		await executeBuiltinSlashCommand("/force", harness.runtime);
		expect(harness.setForcedToolChoice).toHaveBeenCalledWith("write");
		expect(harness.showStatus).toHaveBeenCalledWith(
			"Queued write once, then no tools. Earlier queued directives may run first; no tool has run yet.",
		);
	});

	it("returns remaining prompt text when provided after tool name", async () => {
		const harness = createRuntimeHarness();

		const result = await executeBuiltinSlashCommand("/force:write fix the tests", harness.runtime);

		expect(result).toBe("fix the tests");
		expect(harness.setForcedToolChoice).toHaveBeenCalledWith("write");
		expect(harness.showStatus).toHaveBeenCalledWith(
			"Queued write once, then no tools. Earlier queued directives may run first; no tool has run yet.",
		);
		expect(harness.showError).not.toHaveBeenCalled();
		expect(harness.setText).toHaveBeenCalledWith("");
	});

	it("forces tool with space syntax", async () => {
		const harness = createRuntimeHarness();

		const result = await executeBuiltinSlashCommand("/force write", harness.runtime);

		expect(result).toBe(true);
		expect(harness.setForcedToolChoice).toHaveBeenCalledWith("write");
	});

	it("returns remaining prompt with space syntax", async () => {
		const harness = createRuntimeHarness();

		const result = await executeBuiltinSlashCommand("/force write fix the tests", harness.runtime);

		expect(result).toBe("fix the tests");
		expect(harness.setForcedToolChoice).toHaveBeenCalledWith("write");
	});

	it("surfaces session validation errors", async () => {
		const harness = createRuntimeHarness({
			setForcedToolChoice: () => {
				throw new Error('Tool "write" is not currently active.');
			},
		});

		const handled = await executeBuiltinSlashCommand("/force:write", harness.runtime);

		expect(handled).toBe(true);
		expect(harness.showError).toHaveBeenCalledWith('Tool "write" is not currently active.');
		expect(harness.showStatus).not.toHaveBeenCalled();
		expect(harness.setText).toHaveBeenCalledWith("");
	});

	it("does not pass through prompt when tool validation fails", async () => {
		const harness = createRuntimeHarness({
			setForcedToolChoice: () => {
				throw new Error('Tool "write" is not currently active.');
			},
		});

		const result = await executeBuiltinSlashCommand("/force:write fix stuff", harness.runtime);

		expect(result).toBe(true);
		expect(harness.showError).toHaveBeenCalledWith('Tool "write" is not currently active.');
	});
});
