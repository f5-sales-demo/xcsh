import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";

describe("AgentSession Routing Rejection Escalation (TDD)", () => {
	let tempDir: TempDir;
	let settings: Settings;
	let modelRegistry: ModelRegistry;
	let sessionManager: SessionManager;
	let authStorage: AuthStorage;
	let session: AgentSession;

	beforeEach(async () => {
		tempDir = TempDir.createSync("xcsh-test-rejection");
		settings = Settings.isolated();
		settings.set("routing.mode", "auto");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		modelRegistry = new ModelRegistry(authStorage);
		sessionManager = SessionManager.inMemory();

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				systemPrompt: "You are a test agent",
				model: { provider: "openai", id: "gpt-5.6" } as any,
				tools: [],
			},
		});

		session = new AgentSession({
			agent,
			settings,
			modelRegistry,
			sessionManager,
		});
	});

	afterEach(async () => {
		tempDir.removeSync();
	});

	it("should step escalation sequentially when safeToContinue is true", async () => {
		modelRegistry.getAvailable = () => [{ provider: "openai", id: "gpt-5.4" }] as any;
		modelRegistry.getApiKey = async () => "mock-key";

		const events: any[] = [];
		session.subscribe(e => events.push(e));

		session.restoreRoutingState({ currentTier: "utility" });

		session.recordRoutingOutcome({
			status: "rejected",
			evidence: [{ kind: "test_failure", summary: "Failed" }],
			safeToContinue: true,
		});

		await session.waitForIdle();

		const escalationEvent = events.find(e => e.type === "routing_escalated");
		expect(escalationEvent).toBeDefined();
		expect(escalationEvent.effectiveTier).toBe("balanced");
	});

	it("should not mutate state if mode is shadow", async () => {
		modelRegistry.getAvailable = () => [{ provider: "openai", id: "gpt-5.4" }] as any;
		settings.set("routing.mode", "shadow");

		const events: any[] = [];
		session.subscribe(e => events.push(e));

		session.recordRoutingOutcome({
			status: "rejected",
			evidence: [{ kind: "test_failure", summary: "Failed" }],
			safeToContinue: true,
		});

		await session.waitForIdle();

		const escalationEvent = events.find(e => e.type === "routing_escalated");
		expect(escalationEvent).toBeUndefined();
	});

	it("should not abort agent if target model cannot be resolved during escalation", async () => {
		modelRegistry.getAvailable = () => [];

		let emitCount = 0;
		session.subscribe(e => {
			if (e.type === "routing_escalated") {
				emitCount++;
			}
		});

		session.restoreRoutingState({ currentTier: "utility" });

		let abortCount = 0;
		session.agent.abort = () => {
			abortCount++;
		};

		let continueCount = 0;
		session.agent.continue = () => {
			continueCount++;
			return Promise.resolve();
		};

		session.recordRoutingOutcome({
			status: "rejected",
			evidence: [{ kind: "test_failure", summary: "Failed" }],
			safeToContinue: true,
		});

		await session.waitForIdle();

		expect(abortCount).toBe(0);
		expect(continueCount).toBe(0);

		expect(emitCount).toBe(0);
		expect(session.getRoutingState().currentTier).toBe("utility");
	});
	it("should revert state and resume agent if target exists but switch/authentication fails", async () => {
		modelRegistry.getAvailable = () => [{ provider: "openai", id: "gpt-5.4" }] as any;
		session.setModelRoutingSwitch = async () => {
			throw new Error("Simulated auth failure");
		};

		session.restoreRoutingState({ currentTier: "utility" });

		let abortCount = 0;
		session.agent.abort = () => {
			abortCount++;
		};

		let continueCount = 0;
		session.agent.continue = () => {
			continueCount++;
			return Promise.resolve();
		};

		session.recordRoutingOutcome({
			status: "rejected",
			evidence: [{ kind: "test_failure", summary: "Failed" }],
			safeToContinue: true,
		});

		await session.waitForIdle();

		expect(abortCount).toBe(1);
		expect(continueCount).toBe(1);
		expect(session.getRoutingState().currentTier).toBe("utility");
	});

	it("should not immediately switch model if outcome is unsafe to continue", async () => {
		modelRegistry.getAvailable = () =>
			[
				{ provider: "openai", id: "gpt-5.4" },
				{ provider: "openai", id: "gpt-5.6-sol" },
			] as any;

		let switchCount = 0;
		session.setModelRoutingSwitch = async () => {
			switchCount++;
		};

		session.restoreRoutingState({ currentTier: "utility" });

		session.recordRoutingOutcome({
			status: "rejected",
			evidence: [{ kind: "test_failure", summary: "Failed" }],
			safeToContinue: false,
		});

		await session.waitForIdle();

		expect(switchCount).toBe(0);
	});

	it("should restore model state if escalation swap fails", async () => {
		modelRegistry.getAvailable = () => [{ provider: "openai", id: "gpt-5.4" }] as any;
		modelRegistry.getApiKey = async () => "mock-key";

		const originalSetModel = session.setModelRoutingSwitch.bind(session);
		session.setModelRoutingSwitch = async model => {
			await originalSetModel(model);
			throw new Error("Simulated swap failure");
		};

		session.restoreRoutingState({ currentTier: "utility" });

		let appendedModelId = "";
		let appendedRole = "";
		const originalAppend = session.sessionManager.appendModelChange.bind(session.sessionManager);
		(session.sessionManager as any).appendModelChange = (modelId: string, role: string) => {
			if (role === "routing_switch_rollback") {
				appendedModelId = modelId;
				appendedRole = role;
			}
			originalAppend(modelId, role);
		};

		session.recordRoutingOutcome({
			status: "rejected",
			evidence: [{ kind: "test_failure", summary: "Failed" }],
			safeToContinue: true,
		});

		await session.waitForIdle();

		expect(session.model?.id).toBe("gpt-5.6");
		expect(appendedModelId).toBe("openai/gpt-5.6");
		expect(appendedRole).toBe("routing_switch_rollback");
	});

	it("sendCustomMessage() turn trigger should not bypass routing evaluation", async () => {
		session.settings.set("routing.mode", "auto");
		session.settings.set("routing.pools", "litellm/openai");

		let routingEvaluated = false;
		// Spy on routingCoordinator.evaluateTurn
		const originalEvaluateTurn = (session as any).routingCoordinator.evaluateTurn;
		(session as any).routingCoordinator.evaluateTurn = async (ctx: any) => {
			routingEvaluated = true;
			throw new Error("routing evaluated stop");
		};

		await expect(
			session.sendCustomMessage({ customType: "test", content: "hello", display: true }, { triggerTurn: true }),
		).rejects.toThrow("routing evaluated stop");

		expect(routingEvaluated).toBe(true);
	});
});
