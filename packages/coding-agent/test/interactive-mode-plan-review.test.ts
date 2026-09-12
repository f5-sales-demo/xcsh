import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { mkdir, rmdir } from "node:fs/promises";
import * as path from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Text } from "@f5-sales-demo/pi-tui";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { resolveLocalUrlToPath } from "../src/internal-urls";
import { EventController } from "../src/modes/controllers/event-controller";
import { InteractiveMode } from "../src/modes/interactive-mode";
import { initTheme } from "../src/modes/theme/theme";
import { RemoteSession } from "../src/remote-control/session";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import * as externalEditor from "../src/utils/external-editor";

describe("InteractiveMode plan review rendering", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		_resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-plan-review-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-5");
		if (!model) {
			throw new Error("Expected claude-sonnet-5 to exist in registry");
		}

		session = new AgentSession({
			agent: new Agent({
				initialState: {
					model,
					systemPrompt: "Test",
					tools: [],
					messages: [],
				},
			}),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry,
			toolRegistry: new Map([
				[
					"exit_plan_mode",
					{
						name: "exit_plan_mode",
						label: "Exit plan mode",
						description: "Synthetic plan approval tool",
						parameters: Type.Object({}),
						execute: async () => ({ content: [], details: {} }),
					},
				],
			]),
		});
		mode = new InteractiveMode(session, "test");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		_resetSettingsForTest();
	});

	it("applies remote Plan and Default through the idempotent terminal mode lifecycle", async () => {
		const appendModeChange = vi.spyOn(session.sessionManager, "appendModeChange");
		const workModel = session.model;
		const planModel = modelRegistry.find("anthropic", "claude-opus-5");
		if (!planModel) throw new Error("Expected claude-opus-5 to exist in registry");
		vi.spyOn(session, "resolveRoleModelWithThinking").mockReturnValue({
			model: planModel,
			thinkingLevel: undefined,
			explicitThinkingLevel: false,
			warning: undefined,
		});
		const setModelTemporary = vi.spyOn(session, "setModelTemporary");
		expect(mode.getRemoteCollaborationMode()).toBe("default");
		await mode.setRemoteCollaborationMode("plan");
		expect(mode.getRemoteCollaborationMode()).toBe("plan");
		expect(mode.planModeEnabled).toBe(true);
		expect(session.model).toBe(workModel);
		expect(setModelTemporary).not.toHaveBeenCalled();
		expect(session.getPlanModeState()).toMatchObject({ enabled: true, planFilePath: "local://PLAN.md" });
		await mode.setRemoteCollaborationMode("plan");
		expect(appendModeChange.mock.calls.filter(([value]) => value === "plan")).toHaveLength(1);

		await mode.setRemoteCollaborationMode("default");
		expect(mode.getRemoteCollaborationMode()).toBe("default");
		expect(mode.planModeEnabled).toBe(false);
		expect(session.model).toBe(workModel);
		expect(session.getPlanModeState()).toBeUndefined();
		await mode.setRemoteCollaborationMode("default");
		expect(appendModeChange.mock.calls.filter(([value]) => value === "none")).toHaveLength(1);
	});

	it("re-appends refreshed plan review previews at the chat tail", async () => {
		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# First plan\n\nalpha");

		mode.planModeEnabled = true;
		mode.planModePlanFilePath = planFilePath;
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Stay in plan mode");

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: "local://PLAN.md",
		});

		const firstPreview = mode.chatContainer.children.at(-1);
		expect(firstPreview).toBeDefined();
		expect(firstPreview!.render(120).join("\n")).toContain("First plan");

		const marker = new Text("MARKER", 0, 0);
		mode.chatContainer.addChild(marker);
		await Bun.write(resolvedPlanPath, "# Second plan\n\nbeta");

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: "local://PLAN.md",
		});

		expect(mode.chatContainer.children.at(-1)).toBe(firstPreview);
		expect(mode.chatContainer.children.at(-2)).toBe(marker);
		expect(firstPreview!.render(120).join("\n")).toContain("Second plan");
	});

	it("requires a new review when the plan changes before approval", async () => {
		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionId,
		});
		await Bun.write(resolvedPlanPath, "# Reviewed plan");
		mode.planModeEnabled = true;
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		vi.spyOn(mode, "handleClearCommand").mockImplementation(async (options, createSession) => {
			await (createSession ? createSession(options) : session.newSession(options));
		});
		const choose = vi
			.spyOn(mode, "showHookSelector")
			.mockImplementationOnce(async () => {
				await Bun.write(resolvedPlanPath, "# Changed after review");
				return "Approve and execute";
			})
			.mockResolvedValue("Stay in plan mode");
		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: planFilePath,
		});
		expect(choose).toHaveBeenCalledTimes(2);
		expect(prompt).not.toHaveBeenCalled();
		expect(mode.chatContainer.children.at(-1)!.render(120).join("\n")).toContain("Changed after review");
		expect(mode.planModeEnabled).toBe(true);
	});

	it("concurrent completed plan events share one review and one execution", async () => {
		const planFilePath = "local://PLAN.md";
		await Bun.write(
			resolveLocalUrlToPath(planFilePath, {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionId,
			}),
			"# Reviewed plan",
		);
		mode.planModeEnabled = true;
		const choice = Promise.withResolvers<string | undefined>();
		const choose = vi.spyOn(mode, "showHookSelector").mockReturnValue(choice.promise);
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		vi.spyOn(mode, "handleClearCommand").mockImplementation(async (options, createSession) => {
			await (createSession ? createSession(options) : session.newSession(options));
		});
		const details = { planFilePath, planExists: true, title: "PLAN", finalPlanFilePath: planFilePath };
		const first = mode.handleExitPlanModeTool(details);
		const second = mode.handleExitPlanModeTool(details);
		await Bun.sleep(20);
		choice.resolve("Approve and execute");
		await Promise.all([first, second]);
		expect(choose).toHaveBeenCalledTimes(1);
		expect(prompt).toHaveBeenCalledTimes(1);
	});

	it("the phone reviews the complete plan and can request refinement after its tool finishes", async () => {
		const planFilePath = "local://PLAN.md";
		const content = "# Reviewed plan\n\nCreate only fixture.txt.";
		await Bun.write(
			resolveLocalUrlToPath(planFilePath, {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionId,
			}),
			content,
		);
		mode.planModeEnabled = true;
		const manager = session.sessionManager;
		manager.appendMessage({ role: "user", content: "Prepare a plan", timestamp: 1 });
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "toolCall", id: "plan-call", name: "exit_plan_mode", arguments: { title: "PLAN" } }],
			api: "openai-responses",
			model: "fixture",
			provider: "openai-codex",
			timestamp: 2,
			stopReason: "toolUse",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		} satisfies AssistantMessage);
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "plan-call",
			toolName: "exit_plan_mode",
			content: [{ type: "text", text: "Plan ready for approval." }],
			isError: false,
			timestamp: 3,
		});
		const remote = new RemoteSession(session);
		vi.spyOn(mode, "init").mockResolvedValue();
		const events = new EventController(mode);
		const review = events.handleEvent({
			type: "tool_execution_end",
			toolCallId: "plan-call",
			toolName: "exit_plan_mode",
			isError: false,
			result: {
				content: [{ type: "text", text: "Plan ready for approval." }],
				details: { planFilePath, planExists: true, title: "PLAN", finalPlanFilePath: planFilePath },
			},
		});
		try {
			await Bun.sleep(20);
			const [request] = remote.pendingRequests();
			expect(request).toBeDefined();
			expect(request.params.questions).toMatchObject([
				{ question: expect.stringContaining(content), isOther: false },
			]);
			expect(request.params.itemId).toContain(":tool:plan-call");
			await remote.call(`answer-${request.id}`, "session/interaction/respond", {
				threadId: session.sessionId,
				requestId: request.id,
				response: { answers: { [request.id]: { answers: ["Refine plan"] } } },
			});
			await Bun.sleep(0);
			const [refine] = remote.pendingRequests();
			expect(refine.params.questions).toMatchObject([
				{ question: expect.stringContaining("What should be refined?") },
			]);
			await remote.call(`answer-${refine.id}`, "session/interaction/respond", {
				threadId: session.sessionId,
				requestId: refine.id,
				response: { answers: { [refine.id]: { answers: ["Use fixture-two.txt instead"] } } },
			});
			await review;
			expect(mode.editor.getText()).toBe("Use fixture-two.txt instead");
			expect(mode.planModeEnabled).toBe(true);
			expect(remote.pendingRequests()).toEqual([]);
		} finally {
			session.userInteractions.cancelAll();
			await review;
			await remote.close();
		}
	});

	it("phone approval creates one execution session containing exactly the reviewed plan", async () => {
		const planFilePath = "local://PLAN.md";
		const content = "# Reviewed plan\n\nCreate only fixture.txt.";
		await Bun.write(
			resolveLocalUrlToPath(planFilePath, {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionId,
			}),
			content,
		);
		mode.planModeEnabled = true;
		const manager = session.sessionManager;
		manager.appendMessage({ role: "user", content: "Prepare a plan", timestamp: 1 });
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "toolCall", id: "plan-call", name: "exit_plan_mode", arguments: { title: "PLAN" } }],
			api: "openai-responses",
			model: "fixture",
			provider: "openai-codex",
			timestamp: 2,
			stopReason: "toolUse",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		} satisfies AssistantMessage);
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "plan-call",
			toolName: "exit_plan_mode",
			content: [{ type: "text", text: "Plan ready for approval." }],
			isError: false,
			timestamp: 3,
		});
		const previousSessionId = session.sessionId;
		const previousSessionFile = session.sessionFile;
		await session.setSessionName("xcsh Remote Luna", "user");
		const previousModel = session.model;
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		const remote = new RemoteSession(session);
		const review = mode.handleExitPlanModeTool(
			{ planFilePath, planExists: true, title: "PLAN", finalPlanFilePath: planFilePath },
			"plan-call",
		);
		try {
			await Bun.sleep(20);
			const [stale] = remote.pendingRequests();
			const updatedContent = `${content}\nAlso verify the result.`;
			await Bun.write(
				resolveLocalUrlToPath(planFilePath, {
					getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
					getSessionId: () => session.sessionId,
				}),
				updatedContent,
			);
			await remote.call("approve-stale", "session/interaction/respond", {
				threadId: previousSessionId,
				requestId: stale.id,
				response: { answers: { [stale.id]: { answers: ["Approve and execute"] } } },
			});
			await Bun.sleep(20);
			expect(prompt).not.toHaveBeenCalled();
			const [request] = remote.pendingRequests();
			expect(request.id).not.toBe(stale.id);
			expect(request.params.questions).toMatchObject([{ question: expect.stringContaining(updatedContent) }]);
			expect(request).toBeDefined();
			const response = {
				threadId: previousSessionId,
				requestId: request.id,
				response: { answers: { [request.id]: { answers: ["Approve and execute"] } } },
			};
			expect(await remote.call("approve-once", "session/interaction/respond", response)).toEqual({ accepted: true });
			// A duplicate arriving before the asynchronous session switch cannot start another execution.
			expect(await remote.call("approve-retry", "session/interaction/respond", response)).toEqual({
				accepted: false,
			});
			await review;
			expect(session.sessionId).not.toBe(previousSessionId);
			expect(session.model).toEqual(previousModel);
			expect(session.sessionManager.getHeader()?.parentSession).toBe(previousSessionFile!);
			expect(session.sessionManager.getHeader()?.forkedFromId).toBe(previousSessionId);
			expect(session.sessionManager.getHeader()?.remoteThreadId).toBe(previousSessionId);
			expect(remote.thread()).toMatchObject({
				id: previousSessionId,
				sessionId: previousSessionId,
				forkedFromId: null,
			});
			expect(session.sessionName).toBe("xcsh Remote Luna");
			expect(session.sessionManager.titleSource).toBe("user");
			const source = await SessionManager.open(previousSessionFile!);
			const decision = source
				.getEntries()
				.find(entry => entry.type === "custom" && entry.customType === "plan-review");
			expect(decision).toMatchObject({
				data: { kind: "decision", decision: "Approve and execute", content: updatedContent },
			});
			expect(session.sessionManager.getEntries()).toContainEqual(
				expect.objectContaining({
					customType: "plan-review",
					data: expect.objectContaining({
						kind: "execution",
						sourceSessionId: previousSessionId,
						sourceEntryId: decision!.id,
					}),
				}),
			);
			expect(prompt).toHaveBeenCalledTimes(1);
			expect(prompt.mock.calls[0][0]).toContain(updatedContent);
			const approvedPath = resolveLocalUrlToPath(planFilePath, {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionId,
			});
			expect(await Bun.file(approvedPath).text()).toBe(updatedContent);
			expect(mode.planModeEnabled).toBe(false);
			expect(remote.pendingRequests()).toEqual([]);
		} finally {
			session.userInteractions.cancelAll();
			await review;
			await remote.close();
		}
	});

	it("new agent work retires a pending plan review without approving it", async () => {
		const planFilePath = "local://PLAN.md";
		await Bun.write(
			resolveLocalUrlToPath(planFilePath, {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionId,
			}),
			"# Old plan",
		);
		mode.planModeEnabled = true;
		const review = mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: planFilePath,
		});
		try {
			await Bun.sleep(20);
			expect(session.userInteractions.pending()).toHaveLength(1);
			session.agent.streamFn = () => {
				const stream = new AssistantMessageEventStream();
				const message: AssistantMessage = {
					role: "assistant",
					content: [{ type: "text", text: "New work" }],
					api: "openai-responses",
					model: "fixture",
					provider: "openai-codex",
					timestamp: 5,
					stopReason: "stop",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				};
				queueMicrotask(() => {
					stream.push({ type: "start", partial: { ...message, content: [] } });
					stream.push({ type: "done", reason: "stop", message });
				});
				return stream;
			};
			await session.agent.prompt("Replace the old plan");
			expect(session.userInteractions.pending()).toEqual([]);
			await review;
			expect(mode.planModeEnabled).toBe(true);
		} finally {
			session.userInteractions.cancelAll();
			await review;
		}
	});

	it("a cancelled execution-session switch keeps the plan reviewable and never runs it", async () => {
		const planFilePath = "local://PLAN.md";
		await Bun.write(
			resolveLocalUrlToPath(planFilePath, {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionId,
			}),
			"# Reviewed plan",
		);
		mode.planModeEnabled = true;
		const previousId = session.sessionId;
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Approve and execute");
		vi.spyOn(session, "newSessionWithReviewedPreparation").mockResolvedValue(false);
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "APPROVED",
			finalPlanFilePath: "local://APPROVED.md",
		});
		expect(prompt).not.toHaveBeenCalled();
		expect(session.sessionId).toBe(previousId);
		expect(mode.planModeEnabled).toBe(true);
		expect(mode.planModePlanFilePath).toBe("local://PLAN.md");
		expect(
			session.sessionManager
				.getEntries()
				.filter(entry => entry.type === "custom" && entry.customType === "plan-review"),
		).toMatchObject([{ data: { kind: "decision" } }]);
	});

	it("execution can enter a later plan review before its prompt completes", async () => {
		const planFilePath = "local://PLAN.md";
		await Bun.write(
			resolveLocalUrlToPath(planFilePath, {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionId,
			}),
			"# First plan",
		);
		mode.planModeEnabled = true;
		const started = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		vi.spyOn(session, "prompt").mockImplementation(async () => {
			started.resolve();
			await finish.promise;
		});
		const choose = vi
			.spyOn(mode, "showHookSelector")
			.mockResolvedValueOnce("Approve and execute")
			.mockResolvedValue("Stay in plan mode");
		const details = { planFilePath, planExists: true, title: "PLAN", finalPlanFilePath: planFilePath };
		const first = mode.handleExitPlanModeTool(details);
		await started.promise;
		mode.planModeEnabled = true;
		const second = mode.handleExitPlanModeTool(details);
		try {
			expect(await Promise.race([second.then(() => "reviewed"), Bun.sleep(30).then(() => "pending")])).toBe(
				"reviewed",
			);
			expect(choose).toHaveBeenCalledTimes(2);
		} finally {
			finish.resolve();
			await Promise.all([first, second]);
		}
	});

	it("disposal during terminal acquisition cannot launch an editor afterward", async () => {
		const planFilePath = "local://PLAN.md";
		await Bun.write(
			resolveLocalUrlToPath(planFilePath, {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionId,
			}),
			"# Original plan",
		);
		const acquiring = Promise.withResolvers<void>();
		const acquired = Promise.withResolvers<fs.FileHandle>();
		const close = vi.fn(async () => {});
		const originalOpen = fs.open;
		vi.spyOn(fs, "open").mockImplementation(((...args: Parameters<typeof fs.open>) => {
			if (args[0] === "/dev/tty") {
				acquiring.resolve();
				return acquired.promise;
			}
			return originalOpen(...args);
		}) as typeof fs.open);
		const previousVisual = process.env.VISUAL;
		process.env.VISUAL = "/does-not-exist-xcsh-fixture-editor";
		const stop = vi.spyOn(mode.ui, "stop").mockImplementation(() => {});
		const start = vi.spyOn(mode.ui, "start").mockImplementation(() => {});
		mode.planModeEnabled = true;
		const show = mode.showHookSelector.bind(mode);
		const ready = Promise.withResolvers<() => void>();
		vi.spyOn(mode, "showHookSelector").mockImplementation((...args) => {
			ready.resolve(args[2]!.onExternalEditor!);
			return show(...args);
		});
		const review = mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: planFilePath,
		});
		try {
			(await ready.promise)();
			await acquiring.promise;
			await session.dispose();
			acquired.resolve({ fd: -1, close } as unknown as fs.FileHandle);
			await review;
			for (let i = 0; i < 100 && close.mock.calls.length === 0; i++) await Bun.sleep(5);
			expect(stop).not.toHaveBeenCalled();
			expect(start).not.toHaveBeenCalled();
			expect(close).toHaveBeenCalledTimes(1);
		} finally {
			acquired.resolve({ fd: -1, close } as unknown as fs.FileHandle);
			session.userInteractions.cancelAll();
			await review;
			if (previousVisual === undefined) delete process.env.VISUAL;
			else process.env.VISUAL = previousVisual;
		}
	});

	it.each(["terminal", "phone", "switch"])("plan execution handoff excludes competing %s input", async origin => {
		const planFilePath = "local://PLAN.md";
		await Bun.write(
			resolveLocalUrlToPath(planFilePath, {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionId,
			}),
			"# Approved plan",
		);
		mode.planModeEnabled = true;
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const createSession = session.newSessionWithReviewedPreparation.bind(session);
		vi.spyOn(session, "newSessionWithReviewedPreparation").mockImplementation(
			(preparation, options, preview, scope) =>
				createSession(
					async () => {
						entered.resolve();
						await release.promise;
						await preparation();
					},
					options,
					preview,
					scope,
				),
		);
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Approve and execute");
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		const remote = new RemoteSession(session);
		const review = mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: planFilePath,
		});
		try {
			await entered.promise;
			if (origin === "terminal") await expect(session.steer("Competing instruction")).rejects.toThrow("transition");
			else if (origin === "phone")
				await expect(
					remote.call("competing-prompt", "turn/start", {
						threadId: session.sessionId,
						input: [{ type: "text", text: "Competing instruction" }],
					}),
				).rejects.toThrow();
			else await expect(session.newSession()).rejects.toThrow("transition");
			expect(prompt).not.toHaveBeenCalled();
		} finally {
			release.resolve();
			await review;
			await remote.close();
		}
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(prompt.mock.calls[0][0]).toContain("# Approved plan");
	});
	it("disposal during execution-session preparation waits and never submits the approved plan", async () => {
		const planFilePath = "local://PLAN.md";
		await Bun.write(
			resolveLocalUrlToPath(planFilePath, {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionId,
			}),
			"# Approved before shutdown",
		);
		mode.planModeEnabled = true;
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const createSession = session.newSessionWithReviewedPreparation.bind(session);
		vi.spyOn(session, "newSessionWithReviewedPreparation").mockImplementation(
			(preparation, options, preview, scope) =>
				createSession(
					async () => {
						await preparation();
						entered.resolve();
						await release.promise;
					},
					options,
					preview,
					scope,
				),
		);
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Approve and execute");
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		const close = vi.spyOn(session.sessionManager, "close");
		const review = mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: planFilePath,
		});
		await entered.promise;
		const disposed = session.dispose();
		try {
			await Bun.sleep(20);
			expect(close).not.toHaveBeenCalled();
		} finally {
			release.resolve();
			await Promise.all([review, disposed]);
		}
		expect(prompt).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledTimes(1);
	});
	it.each(["Approve and execute", "Refine plan"])("session changes invalidate plan action %s", async choice => {
		const planFilePath = path.join(tempDir.path(), "review-plan.md");
		await Bun.write(planFilePath, "# Session-specific plan");
		mode.planModeEnabled = true;
		const clear = vi.spyOn(mode, "handleClearCommand").mockResolvedValue();
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		const input = vi.spyOn(mode, "showHookInput").mockResolvedValue("Unreviewed refinement");
		const warning = vi.spyOn(mode, "showWarning");
		vi.spyOn(mode, "showHookSelector").mockImplementation(async () => {
			await session.sessionManager.newSession();
			return choice;
		});
		await mode.handleExitPlanModeTool({
			planFilePath,
			finalPlanFilePath: planFilePath,
			planExists: true,
			title: "PLAN",
		});
		expect(warning).toHaveBeenCalledWith("The plan review session changed. Open a new review before continuing.");
		expect(clear).not.toHaveBeenCalled();
		expect(prompt).not.toHaveBeenCalled();
		expect(input).not.toHaveBeenCalled();
	});
	it.each([false, true])(
		"external editor avoids unchanged or stale-session writes (session changed: %s)",
		async changed => {
			const planFilePath = path.join(tempDir.path(), "editor-plan.md");
			await Bun.write(planFilePath, "Original plan");
			mode.planModeEnabled = true;
			vi.spyOn(externalEditor, "getEditorCommand").mockReturnValue("synthetic-editor");
			vi.spyOn(externalEditor, "openInEditor").mockImplementation(async () => {
				if (changed) await session.sessionManager.newSession();
				return changed ? "Stale edit" : "Original plan";
			});
			const finished = Promise.withResolvers<void>();
			vi.spyOn(mode.ui, "stop").mockImplementation(() => {});
			vi.spyOn(mode.ui, "start").mockImplementation(() => {
				finished.resolve();
			});
			const write = vi.spyOn(Bun, "write");
			vi.spyOn(mode, "showHookSelector").mockImplementation(async (_title, _choices, options) => {
				options?.onExternalEditor?.();
				await finished.promise;
				return "Stay in plan mode";
			});
			await mode.handleExitPlanModeTool({
				planFilePath,
				finalPlanFilePath: planFilePath,
				planExists: true,
				title: "PLAN",
			});
			expect(write).not.toHaveBeenCalled();
			expect(await Bun.file(planFilePath).text()).toBe("Original plan");
		},
	);
	it.each(["cancel", "confirm", "file-drift"])(
		"changed external-editor text requires review before saving (%s)",
		async action => {
			const planFilePath = path.join(tempDir.path(), "edited-plan.md");
			await Bun.write(planFilePath, "Original plan");
			mode.planModeEnabled = true;
			vi.spyOn(externalEditor, "getEditorCommand").mockReturnValue("synthetic-editor");
			vi.spyOn(externalEditor, "openInEditor").mockResolvedValue("Edited plan");
			const resumed = Promise.withResolvers<void>();
			vi.spyOn(mode.ui, "stop").mockImplementation(() => {});
			vi.spyOn(mode.ui, "start").mockImplementation(() => {
				resumed.resolve();
			});
			let reviewFinished: Promise<unknown> | undefined;
			let rendered = "";
			vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
				expect(await Bun.file(planFilePath).text()).toBe("Original plan");
				const completed = Promise.withResolvers<any>();
				reviewFinished = completed.promise;
				const component = await factory(
					{ terminal: { rows: 32 }, requestRender() {} },
					undefined,
					undefined,
					completed.resolve,
				);
				rendered = Bun.stripANSI(component.render(100).join("\n"));
				if (action === "file-drift") await Bun.write(planFilePath, "Concurrent plan");
				if (action !== "cancel") component.handleInput("\x1b[B");
				component.handleInput("\r");
				if (action === "file-drift") {
					for (
						let i = 0;
						i < 100 && !Bun.stripANSI(component.render(100).join("\n")).includes("proposal changed");
						i++
					)
						await Bun.sleep(5);
					const refreshed = Bun.stripANSI(component.render(100).join("\n"));
					expect(refreshed).toContain("proposal changed");
					expect(refreshed).toContain("Concurrent plan → Edited plan");
					expect(await Bun.file(planFilePath).text()).toBe("Concurrent plan");
					component.handleInput("\r"); // Renewed review resets to Cancel.
				}
				return completed.promise;
			});
			vi.spyOn(mode, "showHookSelector").mockImplementation(async (_title, _choices, options) => {
				options?.onExternalEditor?.();
				await resumed.promise;
				await Bun.sleep(5);
				await reviewFinished;
				return "Stay in plan mode";
			});
			await mode.handleExitPlanModeTool({
				planFilePath,
				finalPlanFilePath: planFilePath,
				planExists: true,
				title: "PLAN",
			});
			expect(rendered).toContain("Original plan → Edited plan");
			expect(await Bun.file(planFilePath).text()).toBe(
				action === "confirm" ? "Edited plan" : action === "file-drift" ? "Concurrent plan" : "Original plan",
			);
		},
	);
	it("changed plan content is shown for renewed approval instead of executing", async () => {
		const planFilePath = "local://PLAN.md";
		const resolved = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolved, "# Reviewed plan");
		mode.planModeEnabled = true;
		mode.planModePlanFilePath = planFilePath;
		const clear = vi.spyOn(mode, "handleClearCommand").mockResolvedValue();
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		let choices = 0;
		vi.spyOn(mode, "showHookSelector").mockImplementation(async () => {
			if (choices++ === 0) {
				await Bun.write(resolved, "# Changed plan");
				return "Approve and execute";
			}
			return "Stay in plan mode";
		});
		await mode.handleExitPlanModeTool({
			planFilePath,
			finalPlanFilePath: planFilePath,
			planExists: true,
			title: "PLAN",
		});
		expect(choices).toBe(2);
		expect(clear).not.toHaveBeenCalled();
		expect(prompt).not.toHaveBeenCalled();
		expect(mode.planModeEnabled).toBe(true);
		expect(mode.chatContainer.children.at(-1)!.render(100).join("\n")).toContain("Changed plan");
	});
	it.each(["veto", "accept"] as const)(
		"reviewed new-session preparation runs only beyond the extension boundary (%s)",
		async decision => {
			const manager = SessionManager.create(tempDir.path(), tempDir.path());
			const sequence: string[] = [];
			const extensionRunner = {
				hasHandlers: (name: string) => name === "session_before_switch",
				emit: async (event: { type: string }) => {
					sequence.push(event.type === "session_before_switch" ? "before" : "switch");
					return event.type === "session_before_switch" && decision === "veto" ? { cancel: true } : undefined;
				},
			};
			const reviewedSession = new AgentSession({
				agent: new Agent({
					initialState: { model: session.model, systemPrompt: "Test", tools: [], messages: [] },
				}),
				sessionManager: manager,
				settings: Settings.isolated(),
				modelRegistry: session.modelRegistry,
				extensionRunner: extensionRunner as any,
			});
			const originalId = manager.getSessionId();
			try {
				const switched = await reviewedSession.newSessionWithReviewedPreparation(async () => {
					sequence.push("prepare");
				});
				expect(switched).toBe(decision === "accept");
				expect(sequence).toEqual(decision === "accept" ? ["before", "prepare", "switch"] : ["before"]);
				expect(manager.getSessionId() === originalId).toBe(decision === "veto");
			} finally {
				await reviewedSession.dispose();
			}
		},
	);
	it("approval persistence retries once in the same execution-session identity", async () => {
		const planFilePath = "local://PLAN.md";
		const finalPlanFilePath = "local://RETRIED_PLAN.md";
		const content = "Plan whose execution session save is retried";
		const originalSessionId = session.sessionManager.getSessionId();
		const source = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => originalSessionId,
		});
		await Bun.write(source, content);
		mode.planModeEnabled = true;
		mode.planModePlanFilePath = planFilePath;
		session.setPlanModeState({ enabled: true, planFilePath });
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Approve and execute");
		const newSession = vi.spyOn(session, "newSessionWithReviewedPreparation");
		const retryPersistence = session.sessionManager.retryPersistence.bind(session.sessionManager);
		let failed = false;
		vi.spyOn(session.sessionManager, "retryPersistence").mockImplementation(async () => {
			if (!failed && session.sessionManager.getSessionId() !== originalSessionId) {
				failed = true;
				throw new Error("Synthetic execution-session persistence failure");
			}
			await retryPersistence();
		});
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();

		await mode.handleExitPlanModeTool({
			planFilePath,
			finalPlanFilePath,
			planExists: true,
			title: "RETRIED_PLAN",
		});

		const executionSessionId = session.sessionManager.getSessionId();
		expect(failed).toBe(true);
		expect(executionSessionId).not.toBe(originalSessionId);
		expect(newSession).toHaveBeenCalledTimes(1);
		expect(prompt).toHaveBeenCalledTimes(1);
		const executionCopy = resolveLocalUrlToPath(finalPlanFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => executionSessionId,
		});
		expect(await Bun.file(executionCopy).text()).toBe(content);
		expect((await SessionManager.open(session.sessionManager.getSessionFile()!)).getSessionId()).toBe(
			executionSessionId,
		);
	});
	it.each([false, true])(
		"typed planning prompt is reviewed and submitted only after saving (confirm: %s)",
		async confirm => {
			const text = "Plan the synthetic fixture change";
			const submit = vi.fn(() => {
				const entries = readFileSync(session.sessionManager.getSessionFile()!, "utf8")
					.trim()
					.split("\n")
					.map(line => JSON.parse(line));
				expect(entries.some(entry => entry.type === "mode_change" && entry.mode === "plan")).toBe(true);
			});
			mode.onInputCallback = submit;
			let rendered = "";
			vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
				const completed = Promise.withResolvers<any>();
				const component = await factory(
					{ terminal: { rows: 40 }, requestRender() {} },
					undefined,
					undefined,
					completed.resolve,
				);
				rendered = Bun.stripANSI(component.render(100).join("\n"));
				if (confirm) component.handleInput("\x1b[B");
				component.handleInput("\r");
				return completed.promise;
			});
			await mode.handlePlanModeCommand(text);
			expect(rendered).toContain(text);
			expect(submit).toHaveBeenCalledTimes(confirm ? 1 : 0);
			expect(mode.planModeEnabled).toBe(confirm);
		},
	);
	it("typed planning prompt keeps an already-active plan mode enabled", async () => {
		const text = "Continue planning the active synthetic session";
		mode.planModeEnabled = true;
		mode.planModePlanFilePath = "local://PLAN.md";
		session.setPlanModeState({ enabled: true, planFilePath: "local://PLAN.md" });
		const before = JSON.stringify(session.sessionManager.getEntries());
		const submit = vi.fn();
		mode.onInputCallback = submit;
		let rendered = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			rendered = Bun.stripANSI(component.render(100).join("\n"));
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			return completed.promise;
		});

		await mode.handlePlanModeCommand(text);

		expect(rendered).toContain("Review planning prompt");
		expect(rendered).toContain("Plan mode: on → on");
		expect(rendered).toContain(text);
		expect(mode.planModeEnabled).toBe(true);
		expect(mode.planModePaused).toBe(false);
		expect(submit).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(session.sessionManager.getEntries())).toBe(before);
	});
	it("typed retry reviews replacement of a prompt waiting on plan-mode persistence", async () => {
		const originalPrompt = "Original planning prompt waiting for persistence";
		const replacementPrompt = "Replacement planning prompt after persistence recovery";
		vi.spyOn(session.sessionManager, "flush").mockRejectedValueOnce(new Error("Synthetic plan save failure"));
		const submitted: string[] = [];
		mode.onInputCallback = input => submitted.push(input.text);
		let attempt = 0;
		let retryReview = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			if (attempt++ > 0) retryReview = Bun.stripANSI(component.render(100).join("\n"));
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			if (attempt === 1) {
				for (
					let i = 0;
					i < 100 && !Bun.stripANSI(component.render(100).join("\n")).includes("Synthetic plan save failure");
					i++
				)
					await Bun.sleep(5);
				component.handleInput("\x1b");
			}
			return completed.promise;
		});

		await mode.handlePlanModeCommand(originalPrompt);
		expect(mode.planModeEnabled).toBe(true);
		expect(submitted).toEqual([]);
		await mode.handlePlanModeCommand(replacementPrompt);

		expect(retryReview).toContain("Retry saving only");
		expect(retryReview).toContain("Pending planning prompt");
		expect(retryReview).toContain(originalPrompt);
		expect(retryReview).toContain("Replacement");
		expect(retryReview).toContain("planning prompt after persistence recovery");
		expect(submitted).toEqual([replacementPrompt]);
	});
	it("typed prompt recovers an unresolved pause, re-enables plan mode, and then submits", async () => {
		const prompt = "Resume planning after saving the pending pause";
		mode.planModeEnabled = true;
		mode.planModePlanFilePath = "local://PLAN.md";
		session.setPlanModeState({ enabled: true, planFilePath: "local://PLAN.md" });
		vi.spyOn(session.sessionManager, "flush").mockRejectedValueOnce(new Error("Synthetic paused-state save failure"));
		vi.spyOn(mode, "showHookSelector").mockImplementation(async (_title, choices) => choices[1]);
		const submitted: string[] = [];
		mode.onInputCallback = input => submitted.push(input.text);
		let attempt = 0;
		let recoveryReview = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			if (attempt++ > 0) recoveryReview = Bun.stripANSI(component.render(100).join("\n"));
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			if (attempt === 1) {
				for (
					let i = 0;
					i < 100 &&
					!Bun.stripANSI(component.render(100).join("\n")).includes("Synthetic paused-state save failure");
					i++
				)
					await Bun.sleep(5);
				component.handleInput("\x1b");
			}
			return completed.promise;
		});

		await mode.handlePlanModeCommand();
		expect(mode.planModeEnabled).toBe(false);
		expect(mode.planModePaused).toBe(true);
		expect(submitted).toEqual([]);

		await mode.handlePlanModeCommand(prompt);

		expect(recoveryReview).toContain("Save pending pause, then re-enable");
		expect(recoveryReview).toContain("Plan mode: paused → on");
		expect(recoveryReview).toContain(prompt);
		expect(mode.planModeEnabled).toBe(true);
		expect(mode.planModePaused).toBe(false);
		expect(submitted).toEqual([prompt]);
		const reopened = await SessionManager.open(session.sessionManager.getSessionFile()!);
		expect(reopened.buildSessionContext().mode).toBe("plan");
		await reopened.close();
	});
	it("argument-free plan offers explicit choices without changing session state", async () => {
		const before = JSON.stringify(session.sessionManager.getEntries());
		const chooser = vi.spyOn(mode, "showHookSelector").mockResolvedValue(undefined);
		await mode.handlePlanModeCommand();
		expect(chooser).toHaveBeenCalledWith("Plan mode", ["Cancel", "Enable plan mode"]);
		expect(mode.planModeEnabled).toBe(false);
		expect(JSON.stringify(session.sessionManager.getEntries())).toBe(before);
	});
	it("prompt preparation failure leaves actual active tools and prompt unchanged", async () => {
		const tool = {
			name: "fixture",
			label: "Fixture",
			description: "Synthetic tool",
			parameters: Type.Object({}),
			execute: async () => ({ content: [], details: {} }),
		};
		const agent = new Agent({
			initialState: { model: session.model, systemPrompt: "Original prompt", tools: [tool], messages: [] },
		});
		const manager = SessionManager.inMemory(tempDir.path());
		const rebuild = vi.fn(async () => {
			throw new Error("prompt preparation failed");
		});
		const isolated = new AgentSession({
			agent,
			sessionManager: manager,
			settings: Settings.isolated(),
			modelRegistry: session.modelRegistry,
			toolRegistry: new Map([[tool.name, tool]]),
			rebuildSystemPrompt: rebuild,
		});
		try {
			const before = JSON.stringify(manager.getEntries());
			await expect(isolated.setActiveToolsByName([])).rejects.toThrow("prompt preparation failed");
			expect(isolated.getActiveToolNames()).toEqual(["fixture"]);
			expect(agent.state.systemPrompt).toBe("Original prompt");
			expect(JSON.stringify(manager.getEntries())).toBe(before);
		} finally {
			await isolated.dispose();
		}
	});
	it.each(["selection", "session"])("an older prepared tool update cannot overwrite a changed %s", async change => {
		const tool = {
			name: "fixture",
			label: "Fixture",
			description: "Synthetic",
			parameters: Type.Object({}),
			execute: async () => ({ content: [], details: {} }),
		};
		const agent = new Agent({
			initialState: { model: session.model, tools: [tool], systemPrompt: "Original", messages: [] },
		});
		const slow = Promise.withResolvers<string>();
		const isolated = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry: session.modelRegistry,
			toolRegistry: new Map([[tool.name, tool]]),
			rebuildSystemPrompt: async names => (names.length ? "Latest prompt" : slow.promise),
		});
		try {
			const older = isolated.setActiveToolsByName([]).then(
				() => undefined,
				error => error,
			);
			if (change === "session") await isolated.sessionManager.newSession();
			else await isolated.setActiveToolsByName(["fixture"]);
			const entries = JSON.stringify(isolated.sessionManager.getEntries());
			slow.resolve("Stale prompt");
			expect(await older).toBeInstanceOf(Error);
			expect(isolated.getActiveToolNames()).toEqual(["fixture"]);
			expect(agent.state.systemPrompt).toBe(change === "session" ? "Original" : "Latest prompt");
			expect(JSON.stringify(isolated.sessionManager.getEntries())).toBe(entries);
		} finally {
			slow.resolve("Stale prompt");
			await isolated.dispose();
		}
	});
	it("failed tool activation leaves plan mode disabled and retryable", async () => {
		const activate = vi
			.spyOn(session, "setActiveToolsByName")
			.mockRejectedValueOnce(new Error("tool activation failed"));
		const before = JSON.stringify(session.sessionManager.getEntries());
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Enable plan mode");
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			for (
				let i = 0;
				i < 100 && !Bun.stripANSI(component.render(100).join("\n")).includes("tool activation failed");
				i++
			)
				await Bun.sleep(5);
			expect(Bun.stripANSI(component.render(100).join("\n"))).toContain("tool activation failed");
			component.handleInput("\x1b");
			return completed.promise;
		});
		await mode.handlePlanModeCommand();
		expect(activate).toHaveBeenCalledTimes(1);
		expect(mode.planModeEnabled).toBe(false);
		expect(mode.planModePlanFilePath).toBeUndefined();
		expect(session.getPlanModeState()).toBeUndefined();
		expect(JSON.stringify(session.sessionManager.getEntries())).toBe(before);
	});
	it.each([false, true])(
		"failed plan save retries persistence without applying the mode again (disk failure: %s)",
		async realDiskFailure => {
			const file = session.sessionManager.getSessionFile()!;
			if (realDiskFailure) await mkdir(file, { recursive: true });
			else vi.spyOn(session.sessionManager, "flush").mockRejectedValueOnce(new Error("fixture save failed"));
			const status = vi.spyOn(mode, "showStatus");
			const apply = vi.spyOn(session, "setPlanModeState");
			vi.spyOn(mode, "showHookSelector").mockImplementation(async (_title, choices) => choices[1]);
			let attempt = 0;
			let retryText = "";
			vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
				const completed = Promise.withResolvers<any>();
				const component = await factory(
					{ terminal: { rows: 32 }, requestRender() {} },
					undefined,
					undefined,
					completed.resolve,
				);
				if (attempt++ > 0) retryText = Bun.stripANSI(component.render(100).join("\n"));
				component.handleInput("\x1b[B");
				component.handleInput("\r");
				if (attempt === 1) {
					for (
						let i = 0;
						i < 100 && !Bun.stripANSI(component.render(100).join("\n")).includes("Unresolved plan mode");
						i++
					)
						await Bun.sleep(5);
					expect(Bun.stripANSI(component.render(100).join("\n"))).toContain("Unresolved plan mode");
					component.handleInput("\x1b");
				}
				return completed.promise;
			});
			await mode.handlePlanModeCommand();
			expect(status).not.toHaveBeenCalled();
			if (realDiskFailure) await rmdir(file);
			await mode.handlePlanModeCommand();
			expect(retryText).toContain("Retry saving only");
			expect(apply).toHaveBeenCalledTimes(1);
			expect(mode.planModeEnabled).toBe(true);
			expect(status).toHaveBeenCalledTimes(1);
			const reopened = await SessionManager.open(file);
			expect(reopened.buildSessionContext().mode).toBe("plan");
			expect(reopened.getEntries().filter(entry => entry.type === "mode_change")).toHaveLength(1);
			await reopened.close();
		},
	);
	it("confirmed enable and pause persist mode state for a newly reopened session", async () => {
		expect(session.getActiveToolNames()).toEqual([]);
		vi.spyOn(mode, "showHookSelector").mockImplementation(async (_title, choices) => choices[1]);
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			return completed.promise;
		});
		await mode.handlePlanModeCommand();
		const file = session.sessionManager.getSessionFile()!;
		expect(session.getActiveToolNames()).toEqual(["exit_plan_mode"]);
		expect(await Bun.file(file).exists()).toBe(true);
		let entries = (await Bun.file(file).text())
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		expect(entries.filter(entry => entry.type === "mode_change").map(entry => entry.mode)).toEqual(["plan"]);
		let reopened = await SessionManager.open(file);
		expect(reopened.buildSessionContext().mode).toBe("plan");
		await reopened.close();
		await mode.handlePlanModeCommand();
		entries = (await Bun.file(file).text())
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		expect(entries.filter(entry => entry.type === "mode_change").map(entry => entry.mode)).toEqual([
			"plan",
			"plan_paused",
		]);
		reopened = await SessionManager.open(file);
		expect(reopened.buildSessionContext().mode).toBe("plan_paused");
		await reopened.close();
		expect(mode.planModeEnabled).toBe(false);
		expect(mode.planModePaused).toBe(true);
		expect(session.getActiveToolNames()).toEqual([]);
	});

	it("plan entry confirmation starts on Cancel and preserves session entries", async () => {
		const before = JSON.stringify(session.sessionManager.getEntries());
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Enable plan mode");
		let rendered = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 24 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			rendered = Bun.stripANSI(component.render(80).join("\n"));
			component.handleInput("\r");
			return completed.promise;
		});
		await mode.handlePlanModeCommand();
		expect(rendered).toContain("Review plan mode");
		expect(rendered).toContain("Plan mode: off → on");
		expect(mode.planModeEnabled).toBe(false);
		expect(JSON.stringify(session.sessionManager.getEntries())).toBe(before);
	});

	it("a session identity change invalidates plan confirmation before mutation", async () => {
		const before = JSON.stringify(session.sessionManager.getEntries());
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Enable plan mode");
		let rendered = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 24 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			vi.spyOn(session.sessionManager, "getSessionId").mockReturnValue("different-session");
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			await Bun.sleep(0);
			rendered = Bun.stripANSI(component.render(80).join("\n"));
			component.handleInput("\x1b");
			return completed.promise;
		});
		await mode.handlePlanModeCommand();
		expect(rendered).toContain("changed");
		expect(mode.planModeEnabled).toBe(false);
		expect(JSON.stringify(session.sessionManager.getEntries())).toBe(before);
	});
});
