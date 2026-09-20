import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { InteractiveMode } from "../src/modes/interactive-mode";
import { initTheme } from "../src/modes/theme/theme";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";

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
			toolRegistry: new Map(),
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
		expect(session.getPlanModeState()).toMatchObject({ enabled: true });
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

	it("implements in the same conversation and consumes a decision exactly once", async () => {
		session.setPlanModeState({ enabled: true });
		const plan = session.conversationPlans.append("item", "<proposed_plan>\n# Plan\nWork\n</proposed_plan>")!;
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		vi.spyOn(session, "sendCustomMessage").mockResolvedValue();
		const fresh = vi.spyOn(session, "newSession").mockResolvedValue(true);
		const identity = session.sessionId;
		const resolved: string[] = [];
		session.subscribe(event => {
			if (event.type === "plan_resolved") resolved.push(event.planId);
		});
		expect(await session.decidePlan(plan.id, "implement")).toEqual({ accepted: true });
		expect(prompt).toHaveBeenCalledWith("Implement the plan.", {
			streamingBehavior: "followUp",
			expandPromptTemplates: false,
		});
		expect(fresh).not.toHaveBeenCalled();
		expect(session.sessionId).toBe(identity);
		expect(resolved).toEqual([plan.id]);
		expect(session.getPlanModeState()).toBeUndefined();
		expect(await session.decidePlan(plan.id, "implement")).toEqual({ accepted: false });
	});

	it("creates fresh context only for the explicit action and includes the selected plan", async () => {
		session.setPlanModeState({ enabled: true });
		const plan = session.conversationPlans.append("item", "<proposed_plan>\nSelected plan\n</proposed_plan>")!;
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		vi.spyOn(session, "sendCustomMessage").mockResolvedValue();
		const fresh = vi.spyOn(session, "newSession").mockResolvedValue(true);
		expect(await session.decidePlan(plan.id, "fresh")).toEqual({ accepted: true });
		expect(fresh).toHaveBeenCalledTimes(1);
		expect(prompt.mock.calls[0][0]).toEndWith("\n\nSelected plan");
	});

	it("stay retains planning; superseded decisions cannot start implementation", async () => {
		session.setPlanModeState({ enabled: true });
		const old = session.conversationPlans.append("one", "<proposed_plan>\nOld\n</proposed_plan>")!;
		const current = session.conversationPlans.append("two", "<proposed_plan>\nNew\n</proposed_plan>")!;
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		expect(await session.decidePlan(old.id, "implement")).toEqual({ accepted: false });
		expect(await session.decidePlan(current.id, "stay")).toEqual({ accepted: true });
		expect(session.getPlanModeState()?.enabled).toBe(true);
		expect(prompt).not.toHaveBeenCalled();
	});
	it("a cancelled fresh context keeps the selected decision available", async () => {
		session.setPlanModeState({ enabled: true });
		const plan = session.conversationPlans.append("recover", "<proposed_plan>\nRetry me\n</proposed_plan>")!;
		const fresh = vi.spyOn(session, "newSession").mockResolvedValue(false);
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		expect(await session.decidePlan(plan.id, "fresh")).toEqual({ accepted: false });
		expect(session.conversationPlans.current?.status).toBe("pending");
		expect(session.getPlanModeState()?.enabled).toBe(true);
		expect(prompt).not.toHaveBeenCalled();
		fresh.mockResolvedValue(true);
		expect(await session.decidePlan(plan.id, "fresh")).toEqual({ accepted: true });
	});
	it("Default mode removes the waiting tool from the model-facing active set", () => {
		const waiting = {
			name: "request_user_input",
			label: "Input",
			description: "Input",
			parameters: {},
			execute: async () => ({ content: [], details: {} }),
		};
		session.agent.setTools([waiting as never]);
		session.setPlanModeState(undefined);
		expect(session.getActiveToolNames()).not.toContain("request_user_input");
	});
	it("session changes restore only the destination conversation plan and mode", async () => {
		session.setPlanModeState({ enabled: true });
		session.sessionManager.appendModeChange("plan");
		const plan = session.conversationPlans.append("old", "<proposed_plan>\nSaved plan\n</proposed_plan>")!;
		session.sessionManager.appendCustomEntry("proposed-plan", plan);
		// Materialize the journal so the test exercises a real session switch.
		await session.sessionManager.ensureOnDisk();
		await session.sessionManager.flush();
		const oldFile = session.sessionFile!;
		const persisted = await SessionManager.open(oldFile);
		expect(persisted.getBranch().some(entry => entry.type === "custom" && entry.customType === "proposed-plan")).toBe(
			true,
		);
		await persisted.close();
		expect(await session.newSession()).toBe(true);
		expect(session.conversationPlans.current).toBeUndefined();
		expect(session.getPlanModeState()).toBeUndefined();
		expect(await session.decidePlan(plan.id, "implement")).toEqual({ accepted: false });
		expect(await session.switchSession(oldFile)).toBe(true);
		expect(session.conversationPlans.current).toEqual(plan);
		expect(session.getPlanModeState()?.enabled).toBe(true);
	});
});
