import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { getBundledModel, type Model } from "@f5-sales-demo/pi-ai";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import type { ModelResolutionSource } from "../../src/session/active-model";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

// #2459 requires the about doc to distinguish a mid-session switch from launch configuration, so the
// session has to remember where its model came from.
describe("AgentSession model resolution source", () => {
	let tempDir: TempDir;
	let session: AgentSession;
	const authStorages: AuthStorage[] = [];

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-model-source-");
	});

	afterEach(async () => {
		if (session) await session.dispose();
		for (const authStorage of authStorages.splice(0)) authStorage.close();
		tempDir.removeSync();
	});

	function bundled(id: string): Model {
		const model = getBundledModel("anthropic", id);
		if (!model) throw new Error(`Expected anthropic model ${id} to exist`);
		return model;
	}

	async function createSession(modelResolutionSource?: ModelResolutionSource): Promise<Model> {
		const model = bundled("claude-sonnet-4-5");
		const agent = new Agent({
			initialState: { model, systemPrompt: "Test", tools: [], messages: [] },
		});
		const authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorages.push(authStorage);
		authStorage.setRuntimeApiKey("anthropic", "test-key");

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			modelRegistry: new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml")),
			modelResolutionSource,
		});
		return model;
	}

	it("defaults to config when nothing says otherwise", async () => {
		await createSession();
		expect(session.modelResolutionSource).toBe("config");
	});

	it("reports launch-flag when --model selected the model", async () => {
		await createSession("launch-flag");
		expect(session.modelResolutionSource).toBe("launch-flag");
	});

	// Every runtime mutator funnels through one private method, so this covers Ctrl+P, role cycling
	// and context promotion as well as the explicit setModel call.
	it("flips to runtime-switch when the model changes mid-session", async () => {
		await createSession("launch-flag");
		await session.setModel(bundled("claude-sonnet-4-6"));
		expect(session.modelResolutionSource).toBe("runtime-switch");
	});

	it("still reports runtime-switch after a temporary switch", async () => {
		await createSession("config");
		await session.setModelTemporary(bundled("claude-sonnet-4-6"));
		expect(session.modelResolutionSource).toBe("runtime-switch");
	});

	// A failed switch restores the previous model, and must restore the source with it: otherwise the
	// about doc would describe a runtime-switched model as though it came from config, which is the
	// one outcome #2459 exists to prevent. `switchSession` rolls back and then rethrows.
	//
	// Note this asserts the invariant, not the rollback branch: a missing file fails early, before the
	// model is touched, so the branch that restores it is not reached here. Reaching it needs a
	// session file that rehydrates a different model and *then* fails, which cannot be arranged
	// without stubbing session internals.
	it("leaves the model and its source consistent when a session switch fails", async () => {
		await createSession("config");
		await session.setModel(bundled("claude-sonnet-4-6"));
		expect(session.modelResolutionSource).toBe("runtime-switch");

		await expect(session.switchSession(path.join(tempDir.path(), "does-not-exist.jsonl"))).rejects.toThrow();

		expect(session.model?.id).toBe("claude-sonnet-4-6");
		expect(session.modelResolutionSource).toBe("runtime-switch");
	});
});
