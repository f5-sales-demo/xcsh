import { afterEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent, type AgentTool } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel, type Model } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { AgentSession, type AgentSessionEvent } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";

class MockAssistantStream extends AssistantMessageEventStream {}

function assistant(
	model: Model,
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await Bun.sleep(5);
	}
	throw new Error("Timed out waiting for condition");
}

describe("AgentSession normalized turn phases", () => {
	let session: AgentSession | undefined;
	let authStorage: AuthStorage | undefined;
	let tempDir: TempDir | undefined;

	afterEach(async () => {
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
	});

	it("keeps the turn active until delayed post-tool consumer work settles", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini");
		if (!model) throw new Error("Expected bundled OpenAI test model");
		tempDir = TempDir.createSync("@pi-turn-phase-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.setRuntimeApiKey(model.provider, "test-key");

		const intentObserved = Promise.withResolvers<void>();
		const finishIntent = Promise.withResolvers<void>();
		const dispatchObserved = Promise.withResolvers<void>();
		const finishTool = Promise.withResolvers<void>();
		const finalModelTurnObserved = Promise.withResolvers<void>();
		const finishFinalModelTurn = Promise.withResolvers<void>();
		const uiFinalizationObserved = Promise.withResolvers<void>();
		const finishUiFinalization = Promise.withResolvers<void>();
		const toolCall = { type: "toolCall" as const, id: "PRIVATE_CALL_ID", name: "bash", arguments: {} };
		let modelTurn = 0;
		const tool: AgentTool = {
			name: "bash",
			label: "Bash",
			description: "Test tool",
			parameters: Type.Object({}),
			execute: async () => {
				dispatchObserved.resolve();
				await finishTool.promise;
				return { content: [{ type: "text", text: "PRIVATE_RESULT" }], details: {} };
			},
		};
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [tool], messages: [] },
			streamFn: () => {
				const stream = new MockAssistantStream();
				modelTurn++;
				void (async () => {
					if (modelTurn === 1) {
						const partial = assistant(model, [toolCall], "toolUse");
						stream.push({ type: "start", partial: assistant(model, [], "toolUse") });
						stream.push({ type: "toolcall_start", contentIndex: 0, partial });
						intentObserved.resolve();
						await finishIntent.promise;
						stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial });
						stream.push({ type: "done", reason: "toolUse", message: partial });
						return;
					}
					finalModelTurnObserved.resolve();
					await finishFinalModelTurn.promise;
					const final = assistant(model, [{ type: "text", text: "done" }], "stop");
					stream.push({ type: "start", partial: assistant(model, [], "stop") });
					stream.push({ type: "done", reason: "stop", message: final });
				})();
				return stream;
			},
		});

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry: new ModelRegistry(authStorage),
		});
		const phases: string[] = [];
		let uiFinalizationSettled = false;
		let idleObservedBeforeUiFinalizationSettled = false;
		session.subscribe(async (event: AgentSessionEvent) => {
			if (event.type === "agent_end") {
				uiFinalizationObserved.resolve();
				await finishUiFinalization.promise;
				uiFinalizationSettled = true;
			}
			if (event.type === "turn_phase") {
				phases.push(event.phase);
				if (event.phase === "idle" && !uiFinalizationSettled) {
					idleObservedBeforeUiFinalizationSettled = true;
				}
			}
		});

		const prompt = session.prompt("PRIVATE_PROMPT");
		await intentObserved.promise;
		await waitFor(() => phases.at(-1) === "tool_call");

		finishIntent.resolve();
		await dispatchObserved.promise;
		expect(phases.at(-1)).toBe("tool_call");
		finishTool.resolve();
		await finalModelTurnObserved.promise;
		await waitFor(() => phases.at(-1) === "thinking");

		finishFinalModelTurn.resolve();
		await uiFinalizationObserved.promise;
		await Bun.sleep(0);
		const phaseDuringUiFinalization = phases.at(-1);
		finishUiFinalization.resolve();
		await prompt;
		await waitFor(() => phases.at(-1) === "idle");
		expect(phaseDuringUiFinalization).toBe("thinking");
		expect(idleObservedBeforeUiFinalizationSettled).toBe(false);
		expect(JSON.stringify(phases)).not.toContain("PRIVATE_");
	});
});
