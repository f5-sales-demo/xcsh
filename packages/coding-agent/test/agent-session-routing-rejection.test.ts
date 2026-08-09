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

		expect(abortCount).toBe(1);
		expect(continueCount).toBe(1);

		expect(emitCount).toBe(0);
		expect(session.getRoutingState().currentTier).toBe("utility");
	});
});
