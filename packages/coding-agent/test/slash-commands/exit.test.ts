import { beforeAll, describe, expect, it, vi } from "bun:test";
import type { Component } from "@f5-sales-demo/pi-tui";
import { getThemeByName, setThemeInstance } from "../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../src/modes/types";
import { executeBuiltinSlashCommand } from "../../src/slash-commands/builtin-registry";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

interface MutableWork {
	streaming: boolean;
	compacting: boolean;
	handoff: boolean;
	bash: boolean;
	python: boolean;
	queued: number;
	jobs: string[];
}

function harness(initial: Partial<MutableWork> = {}, inputs: string[] = []) {
	const work: MutableWork = {
		streaming: false,
		compacting: false,
		handoff: false,
		bash: false,
		python: false,
		queued: 0,
		jobs: [],
		...initial,
	};
	const screens: string[] = [];
	let component: Component | undefined;
	const shutdown = vi.fn(async () => {});
	const clearQueue = vi.fn(() => {
		const queued = work.queued;
		work.queued = 0;
		return { steering: Array.from({ length: queued }, () => "queued"), followUp: [] };
	});
	const abort = vi.fn(async () => {
		work.streaming = false;
	});
	const abortCompaction = vi.fn(() => {
		work.compacting = false;
	});
	const abortHandoff = vi.fn(() => {
		work.handoff = false;
	});
	const abortBash = vi.fn(() => {
		work.bash = false;
	});
	const abortPython = vi.fn(() => {
		work.python = false;
	});
	const ctx = {
		editor: { setText: vi.fn() },
		sessionManager: { getSessionId: () => "exit-session-id" },
		session: {
			get isStreaming() {
				return work.streaming;
			},
			get isCompacting() {
				return work.compacting;
			},
			get isGeneratingHandoff() {
				return work.handoff;
			},
			get isBashRunning() {
				return work.bash;
			},
			get isPythonRunning() {
				return work.python;
			},
			get queuedMessageCount() {
				return work.queued;
			},
			getAsyncJobSnapshot: () => ({
				running: work.jobs.map(id => ({ id })),
				recent: [],
			}),
			clearQueue,
			abort,
			abortCompaction,
			abortHandoff,
			abortBash,
			abortPython,
		},
		shutdown,
		showStatus: vi.fn(),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (outcome: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				component = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
				screens.push(Bun.stripANSI(component.render(80).join("\n")));
				for (const input of inputs) component.handleInput?.(input);
			}),
	} as unknown as InteractiveModeContext;
	return {
		ctx,
		work,
		screens,
		shutdown,
		clearQueue,
		abort,
		abortCompaction,
		abortHandoff,
		abortBash,
		abortPython,
		text: () => Bun.stripANSI(component?.render(80).join("\n") ?? ""),
		input: (key: string) => component?.handleInput?.(key),
	};
}

describe("/exit and /quit", () => {
	it("exit immediately when no work would be abandoned", async () => {
		for (const command of ["/exit", "/quit"]) {
			const h = harness();
			expect(await executeBuiltinSlashCommand(command, { ctx: h.ctx, handleBackgroundCommand() {} })).toBe(true);
			expect(h.shutdown).toHaveBeenCalledTimes(1);
			expect(h.screens).toHaveLength(0);
		}
	});

	it("defaults outstanding-work review to Cancel without changing execution", async () => {
		const h = harness(
			{ streaming: true, compacting: true, handoff: true, bash: true, python: true, queued: 2, jobs: ["job-a"] },
			["\r"],
		);
		await executeBuiltinSlashCommand("/exit", { ctx: h.ctx, handleBackgroundCommand() {} });

		expect(h.screens[0]).toContain("Review exit session");
		expect(h.screens[0]).toContain("Target: session:exit-session-id");
		expect(h.screens[0]).toContain("Active response: Running → Interrupt");
		expect(h.screens[0]).toContain("Queued prompts: 2 → Discard");
		expect(h.screens[0]).toContain("Non-cancellable async jobs: 1 (job-a) → Wait for completion");
		expect(h.shutdown).not.toHaveBeenCalled();
		expect(h.clearQueue).not.toHaveBeenCalled();
		expect(h.abort).not.toHaveBeenCalled();
	});

	it("interrupts supported work, clears queues, waits for async jobs, then exits", async () => {
		const h = harness(
			{ streaming: true, compacting: true, handoff: true, bash: true, python: true, queued: 2, jobs: ["job-a"] },
			["\x1b[B", "\r"],
		);
		const completion = executeBuiltinSlashCommand("/quit", { ctx: h.ctx, handleBackgroundCommand() {} });
		await Bun.sleep(5);
		expect(h.shutdown).not.toHaveBeenCalled();
		h.work.jobs = [];
		await completion;

		expect(h.clearQueue).toHaveBeenCalledTimes(1);
		expect(h.abort).toHaveBeenCalledTimes(1);
		expect(h.abortCompaction).toHaveBeenCalledTimes(1);
		expect(h.abortHandoff).toHaveBeenCalledTimes(1);
		expect(h.abortBash).toHaveBeenCalledTimes(1);
		expect(h.abortPython).toHaveBeenCalledTimes(1);
		expect(h.shutdown).toHaveBeenCalledTimes(1);
	});

	it("requires renewed confirmation if outstanding work changes during review", async () => {
		const h = harness({ streaming: true });
		const completion = executeBuiltinSlashCommand("/exit", { ctx: h.ctx, handleBackgroundCommand() {} });
		await Bun.sleep(1);
		h.work.streaming = false;
		h.input("\x1b[B");
		h.input("\r");
		await Bun.sleep(5);
		expect(h.text()).toContain("The proposal changed. Review the updated values before confirming.");
		expect(h.shutdown).not.toHaveBeenCalled();
		h.input("\x1b[B");
		h.input("\r");
		await completion;
		expect(h.shutdown).toHaveBeenCalledTimes(1);
	});
});
