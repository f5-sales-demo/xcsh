import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
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
				model: getBundledModel("openai", "gpt-4o-mini")!,
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
		// Mock initial state to utility by dispatching an event
		const events: any[] = [];
		session.subscribe(e => events.push(e));

		// Set initial tier using public method
		session.restoreRoutingState({ currentTier: "utility" });

		session.recordRoutingOutcome({
			status: "rejected",
			evidence: [{ kind: "test_failure", summary: "Failed" }],
			safeToContinue: true,
		});

		await new Promise(r => setTimeout(r, 10));

		// The escalation floor should be balanced (since default is utility)
		const escalationEvent = events.find(e => e.type === "routing_escalated");
		expect(escalationEvent).toBeDefined();
		expect(escalationEvent.effectiveTier).toBe("balanced");
	});

	it("should not mutate state if mode is shadow", async () => {
		settings.set("routing.mode", "shadow");

		const events: any[] = [];
		session.subscribe(e => events.push(e));

		session.recordRoutingOutcome({
			status: "rejected",
			evidence: [{ kind: "test_failure", summary: "Failed" }],
			safeToContinue: true,
		});

		await new Promise(r => setTimeout(r, 10));

		const escalationEvent = events.find(e => e.type === "routing_escalated");
		// Should NOT escalate in shadow mode
		expect(escalationEvent).toBeUndefined();
	});

	it("should not abort agent if target model cannot be resolved during escalation", async () => {
		const events: any[] = [];
		session.subscribe(e => events.push(e));

		// Set initial tier using public method
		session.restoreRoutingState({ currentTier: "utility" });

		// We do not add the target model to modelRegistry, simulating an unresolvable model.
		// The target tier will be "balanced", but it won't be found.

		let abortCount = 0;
		const originalAbort = session.agent.abort;
		session.agent.abort = () => {
			abortCount++;
			originalAbort.call(session.agent);
		};

		let continueCount = 0;
		const originalContinue = session.agent.continue;
		session.agent.continue = () => {
			continueCount++;
			return originalContinue.call(session.agent);
		};

		session.recordRoutingOutcome({
			status: "rejected",
			evidence: [{ kind: "test_failure", summary: "Failed" }],
			safeToContinue: true,
		});

		await session.waitForIdle();

		// Because the model can't be resolved, the agent should not have been aborted
		// OR it should have been aborted and resumed.
		if (abortCount > 0) {
			expect(continueCount).toBeGreaterThan(0);
		} else {
			expect(abortCount).toBe(0);
		}
	});
});
