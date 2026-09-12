import { describe, expect, it, vi } from "bun:test";
import type { InteractiveModeContext } from "../../src/modes/types";
import { executeBuiltinSlashCommand } from "../../src/slash-commands/builtin-registry";

function harness(refreshSlashCommandState: () => Promise<void>) {
	const showStatus = vi.fn();
	const showError = vi.fn();
	const setText = vi.fn();
	const ctx = {
		editor: { setText },
		sessionManager: { getCwd: () => "/tmp/xcsh-reload-plugins-fixture" },
		refreshSlashCommandState,
		showStatus,
		showError,
	} as unknown as InteractiveModeContext;
	return {
		ctx,
		showStatus,
		showError,
		setText,
		runtime: { ctx, handleBackgroundCommand() {} },
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for reload fixture state");
}

describe("/reload-plugins", () => {
	it("distinguishes metadata refresh from process restart and reports success only after completion", async () => {
		let finish!: () => void;
		const refresh = vi.fn(
			() =>
				new Promise<void>(resolve => {
					finish = resolve;
				}),
		);
		const h = harness(refresh);

		const pending = executeBuiltinSlashCommand("/reload-plugins", h.runtime);
		await waitFor(() => refresh.mock.calls.length === 1);
		expect(h.setText).toHaveBeenCalledWith("");
		expect(h.showStatus).toHaveBeenCalledWith(
			"Refreshing plugin metadata… Running plugin processes will not be restarted.",
		);
		expect(h.showStatus).not.toHaveBeenCalledWith(expect.stringContaining("metadata refreshed"));

		finish();
		expect(await pending).toBe(true);
		expect(h.showStatus).toHaveBeenLastCalledWith(
			"Plugin metadata refreshed. Commands, skills, hooks, tools, agents, and MCP registrations now use the latest discovered files. Running plugin processes were not restarted.",
		);
		expect(h.showError).not.toHaveBeenCalled();
	});

	it("rejects duplicate refreshes while retaining the original operation", async () => {
		let finish!: () => void;
		const refresh = vi.fn(
			() =>
				new Promise<void>(resolve => {
					finish = resolve;
				}),
		);
		const h = harness(refresh);

		const first = executeBuiltinSlashCommand("/reload-plugins", h.runtime);
		await waitFor(() => refresh.mock.calls.length === 1);
		expect(await executeBuiltinSlashCommand("/reload-plugins", h.runtime)).toBe(true);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(h.showStatus).toHaveBeenLastCalledWith(
			"Plugin metadata refresh already in progress; no duplicate refresh was started.",
		);

		finish();
		await first;
		expect(h.showStatus).toHaveBeenLastCalledWith(expect.stringContaining("metadata refreshed"));
	});

	it("keeps failure distinct from completion and permits a later retry", async () => {
		const refresh = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error("synthetic registry parse failure"))
			.mockResolvedValueOnce();
		const h = harness(refresh);

		expect(await executeBuiltinSlashCommand("/reload-plugins", h.runtime)).toBe(true);
		expect(h.showError).toHaveBeenCalledWith(
			"Plugin metadata refresh failed: synthetic registry parse failure. The process was not restarted; resolve the problem and run /reload-plugins again.",
		);
		expect(h.showStatus).not.toHaveBeenCalledWith(expect.stringContaining("metadata refreshed"));

		expect(await executeBuiltinSlashCommand("/reload-plugins", h.runtime)).toBe(true);
		expect(refresh).toHaveBeenCalledTimes(2);
		expect(h.showStatus).toHaveBeenLastCalledWith(expect.stringContaining("metadata refreshed"));
	});
});
