import { afterEach, describe, expect, it, vi } from "bun:test";
import { InputController } from "../src/modes/controllers/input-controller";
import type { InteractiveModeContext } from "../src/modes/types";
import { executeBuiltinSlashCommand } from "../src/slash-commands/builtin-registry";

afterEach(() => vi.restoreAllMocks());

function context(options: { streaming?: boolean; queued?: number; runningJobs?: number; backgrounded?: boolean } = {}) {
	const showStatus = vi.fn();
	const showWarning = vi.fn();
	const prepareBtwForBackground = vi.fn(() => true);
	const stop = vi.fn();
	const clear = vi.fn();
	const dispose = vi.fn();
	const subscribe = vi.fn(() => vi.fn());
	const ctx = {
		isBackgrounded: options.backgrounded ?? false,
		isInitialized: true,
		loadingAnimation: undefined,
		autoCompactionLoader: undefined,
		retryLoader: undefined,
		session: {
			isStreaming: options.streaming ?? false,
			queuedMessageCount: options.queued ?? 0,
			getAsyncJobSnapshot: () => ({
				running: Array.from({ length: options.runningJobs ?? 0 }, (_, index) => ({ id: `job-${index}` })),
				recent: [],
			}),
			subscribe,
		},
		sessionManager: {
			getSessionId: () => "session-fixture-id",
			getSessionName: () => "Synthetic session",
		},
		hasActiveBtw: () => true,
		prepareBtwForBackground,
		createBackgroundUiContext: () => ({ fixture: true }),
		setToolUIContext: vi.fn(),
		initializeHookRunner: vi.fn(),
		statusContainer: { clear },
		statusLine: { dispose },
		ui: { stop },
		handleBackgroundEvent: vi.fn(),
		beginBackgroundCompletionTracking: vi.fn(),
		showStatus,
		showWarning,
	} as unknown as InteractiveModeContext;
	return { ctx, showStatus, showWarning, prepareBtwForBackground, stop, clear, dispose, subscribe };
}

describe("background execution transfer", () => {
	it("identifies continuing session work without reporting cancellation", () => {
		const h = context({ streaming: true, queued: 2, runningJobs: 1 });
		const output: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
			output.push(String(chunk));
			return true;
		});
		const suspend = vi.spyOn(process, "kill").mockImplementation(() => true);

		new InputController(h.ctx).handleBackgroundCommand();

		expect(h.ctx.isBackgrounded).toBe(true);
		expect(h.ctx.isInitialized).toBe(false);
		expect(h.prepareBtwForBackground).toHaveBeenCalledTimes(1);
		expect(h.stop).toHaveBeenCalledTimes(1);
		expect(h.clear).toHaveBeenCalledTimes(1);
		expect(h.dispose).toHaveBeenCalledTimes(1);
		expect(h.subscribe).toHaveBeenCalledTimes(1);
		expect(h.ctx.beginBackgroundCompletionTracking).toHaveBeenCalledTimes(1);
		const rendered = output.join("");
		expect(rendered).toContain("Synthetic session (session-fixture-id)");
		expect(rendered).toContain("the active response, 2 queued prompts, 1 async tool job");
		expect(rendered).toContain("nothing was cancelled");
		if (process.stdout.isTTY) {
			expect(rendered).toContain("run `bg` to continue headlessly, or `fg` to wait for completion");
			expect(rendered).toContain("Reopen this session to return");
			expect(rendered).toContain("use `/jobs` to inspect async tool jobs");
			expect(suspend).toHaveBeenCalledWith(0, "SIGTSTP");
		} else {
			expect(rendered).toContain("continuing headlessly in the foreground");
			expect(suspend).not.toHaveBeenCalled();
		}
	});

	it("keeps a running foreground /btw visible and refuses an untracked transfer", () => {
		const h = context({ streaming: true });
		h.prepareBtwForBackground.mockReturnValue(false);

		new InputController(h.ctx).handleBackgroundCommand();

		expect(h.ctx.isBackgrounded).toBe(false);
		expect(h.stop).not.toHaveBeenCalled();
		expect(h.subscribe).not.toHaveBeenCalled();
	});

	it("keeps already-backgrounded and idle requests as explicit no-ops", () => {
		const already = context({ backgrounded: true, streaming: true });
		new InputController(already.ctx).handleBackgroundCommand();
		expect(already.showStatus).toHaveBeenCalledWith("Background mode already enabled");
		expect(already.stop).not.toHaveBeenCalled();

		const idle = context();
		new InputController(idle.ctx).handleBackgroundCommand();
		expect(idle.showWarning).toHaveBeenCalledWith("Agent is idle; nothing to background");
		expect(idle.stop).not.toHaveBeenCalled();
	});

	it("routes /background and /bg through the same transfer entry point", async () => {
		for (const command of ["/background", "/bg"]) {
			const setText = vi.fn();
			const handleBackgroundCommand = vi.fn();
			const ctx = { editor: { setText } } as unknown as InteractiveModeContext;
			expect(await executeBuiltinSlashCommand(command, { ctx, handleBackgroundCommand })).toBe(true);
			expect(setText).toHaveBeenCalledWith("");
			expect(handleBackgroundCommand).toHaveBeenCalledTimes(1);
		}
	});
});
