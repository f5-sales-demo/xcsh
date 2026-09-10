import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Text } from "@f5-sales-demo/pi-tui";
import { TempDir } from "@f5-sales-demo/pi-utils";
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

describe("InteractiveMode plan review rendering", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
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
		const modelRegistry = new ModelRegistry(authStorage);
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
		vi.spyOn(mode, "handleClearCommand").mockImplementation(async options => {
			await session.newSession(options);
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
		vi.spyOn(mode, "handleClearCommand").mockImplementation(async options => {
			await session.newSession(options);
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
		vi.spyOn(session, "newSession").mockResolvedValue(false);
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
		expect(mode.planModePlanFilePath).toBe("local://APPROVED.md");
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
});
