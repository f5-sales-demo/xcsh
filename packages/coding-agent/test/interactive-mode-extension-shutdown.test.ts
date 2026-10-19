import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { postmortem, TempDir } from "@f5-sales-demo/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import type { ExtensionContextActions, ExtensionUIContext } from "../src/extensibility/extensions";
import type { ExtensionRunner } from "../src/extensibility/extensions/runner";
import { ExtensionUiController } from "../src/modes/controllers/extension-ui-controller";
import { InteractiveMode } from "../src/modes/interactive-mode";
import { initTheme } from "../src/modes/theme/theme";
import type { InteractiveModeContext } from "../src/modes/types";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import { EventBus } from "../src/utils/event-bus";

describe("InteractiveMode extension shutdown", () => {
	let authStorage: AuthStorage;
	let eventBus: EventBus;
	let mode: InteractiveMode;
	let session: AgentSession;
	let tempDir: TempDir;
	let shutdownEvent: ReturnType<typeof vi.fn>;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		vi.spyOn(process.stdout, "write").mockReturnValue(true);
		vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);
		vi.spyOn(process.stdin, "pause").mockReturnValue(process.stdin);
		vi.spyOn(process.stdin, "setEncoding").mockReturnValue(process.stdin);
		if (typeof process.stdin.setRawMode === "function") {
			vi.spyOn(process.stdin, "setRawMode").mockReturnValue(process.stdin);
		}

		_resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-finish-pending-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-5");
		if (!model) throw new Error("Expected claude-sonnet-5 to exist in registry");

		shutdownEvent = vi.fn();
		session = new AgentSession({
			extensionRunner: {
				getAllRegisteredTools: () => [],
				getRegisteredCommandEntries: () => [],
				hasHandlers: (event: string) => event === "session_shutdown",
				emit: async () => {
					shutdownEvent();
					mode.requestShutdown();
				},
			} as unknown as ExtensionRunner,
			agent: new Agent({
				initialState: { model, systemPrompt: "Test", tools: [], messages: [] },
			}),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry,
		});
		eventBus = new EventBus();
		mode = new InteractiveMode(session, "test", () => {}, undefined, eventBus);
	});

	afterEach(async () => {
		mode?.stop();
		vi.restoreAllMocks();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		_resetSettingsForTest();
	});

	it("defers idle shutdown until the extension callback returns without another input", async () => {
		const shutdown = vi.spyOn(mode, "shutdown").mockResolvedValue(undefined);
		mode.requestShutdown();
		expect(mode.shutdownRequested).toBe(true);
		expect(shutdown).not.toHaveBeenCalled();
		await Bun.sleep(20);
		expect(shutdown).toHaveBeenCalledTimes(1);
	});

	it("coalesces repeated requests including a request during teardown", async () => {
		const shutdown = vi.spyOn(mode, "shutdown").mockImplementation(async () => {
			mode.requestShutdown();
		});
		mode.requestShutdown();
		mode.requestShutdown();
		await Bun.sleep(20);
		expect(shutdown).toHaveBeenCalledTimes(1);
	});

	it("drains active cancellation before emitting shutdown and cleaning up once", async () => {
		const abortEntered = Promise.withResolvers<void>();
		const releaseAbort = Promise.withResolvers<void>();
		const cleaned = Promise.withResolvers<void>();
		let callbackReturned = false;
		const abort = vi.spyOn(session, "abort").mockImplementation(async () => {
			expect(callbackReturned).toBe(true);
			abortEntered.resolve();
			await releaseAbort.promise;
		});
		const cleanup = vi.fn(() => cleaned.resolve());
		session.addDisposeHook(cleanup);
		const quit = vi.spyOn(postmortem, "quit").mockResolvedValue(undefined);
		vi.spyOn(mode.ui.terminal, "drainInput").mockResolvedValue(undefined);
		vi.spyOn(process.stderr, "write").mockReturnValue(true);
		mode.requestShutdown();
		callbackReturned = true;
		await abortEntered.promise;
		expect(cleanup).not.toHaveBeenCalled();
		expect(shutdownEvent).not.toHaveBeenCalled();
		mode.requestShutdown();
		releaseAbort.resolve();
		await cleaned.promise;
		await Bun.sleep(20);
		expect(abort).toHaveBeenCalledTimes(1);
		expect(shutdownEvent).toHaveBeenCalledTimes(1);
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(quit).toHaveBeenCalledWith(0);
	});
});

describe("interactive extension shutdown context bindings", () => {
	beforeAll(() => initTheme());

	for (const surface of ["foreground", "background", "tool-session"] as const) {
		it(`routes ${surface} requests to the interactive runtime`, async () => {
			let contextActions: ExtensionContextActions | undefined;
			let toolContext: { shutdown(): void } | undefined;
			const uiContext = {} as ExtensionUIContext;
			const requestShutdown = vi.fn();
			const runner = {
				initialize: (_actions: unknown, actions: ExtensionContextActions) => {
					contextActions = actions;
				},
				onError: () => {},
				emit: async () => {},
				getUIContext: () => uiContext,
				getAllRegisteredTools: () => [
					{
						definition: {
							onSession: async (_event: unknown, ctx: { shutdown(): void }) => {
								toolContext = ctx;
							},
						},
					},
				],
			};
			const ctx = {
				session: {
					extensionRunner: runner,
					subscribe: () => {},
					userInteractions: { subscribe: () => {}, setAsyncPresenter: () => {}, setQuestionPresenter: () => {} },
				},
				sessionManager: { getCwd: () => "/fixture" },
				setToolUIContext: () => {},
				requestShutdown,
				isBackgrounded: surface === "background",
			} as unknown as InteractiveModeContext;
			const controller = new ExtensionUiController(ctx);
			if (surface === "foreground") await controller.initHooksAndCustomTools();
			else if (surface === "background") controller.initializeHookRunner(uiContext, false);
			else await controller.emitCustomToolSessionEvent("start");
			const context = surface === "tool-session" ? toolContext : contextActions;
			expect(context).toBeDefined();
			context!.shutdown();
			expect(requestShutdown).toHaveBeenCalledTimes(1);
		});
	}
});
