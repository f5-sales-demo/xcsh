import { afterEach, describe, expect, it } from "bun:test";
import { Agent, type AgentTool } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel, type Message } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { convertToLlm } from "../src/session/messages";
import { SessionManager } from "../src/session/session-manager";

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
async function create(available = true, active = false) {
	const auth = await AuthStorage.create(":memory:");
	cleanup.push(() => auth.close());
	auth.setRuntimeApiKey("anthropic", "synthetic-key");
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	const tools = ["read", "search_tool_bm25", ...(available ? ["xcsh_blindfold"] : [])].map(
		name =>
			({
				name,
				label: name,
				description: name,
				parameters: Type.Object({}),
				execute: async () => ({ content: [] }),
			}) satisfies AgentTool,
	);
	const requests: Message[][] = [];
	const agent = new Agent({
		getApiKey: () => "synthetic-key",
		initialState: { model, systemPrompt: "Test", tools: tools.filter(t => active || t.name !== "xcsh_blindfold") },
		convertToLlm,
		streamFn: (_model, context) => {
			requests.push([...context.messages]);
			const stream = new AssistantMessageEventStream();
			const message: AssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "done" }],
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
				stopReason: "stop",
				timestamp: Date.now(),
			};
			queueMicrotask(() => stream.push({ type: "done", reason: "stop", message }));
			return stream;
		},
	});
	const session = new AgentSession({
		agent,
		sessionManager: SessionManager.inMemory(),
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry: new ModelRegistry(auth),
		toolRegistry: new Map(tools.map(t => [t.name, t])),
		apiCatalogPreflight: async () => null,
		terraformPreflight: async () => null,
	});
	cleanup.push(() => session.dispose());
	return { session, requests };
}
function hints(messages: Message[]) {
	return messages.filter(m => JSON.stringify(m).includes("Native Blindfold capability"));
}
describe("shared runtime Blindfold awareness", () => {
	it("injects before inference and user text without activating schemas", async () => {
		const { session, requests } = await create();
		await session.prompt("Can I upload my custom certificate?");
		expect(hints(requests[0])).toHaveLength(1);
		expect(requests[0].at(-1)?.content).toEqual([{ type: "text", text: "Can I upload my custom certificate?" }]);
		expect(session.getActiveToolNames()).not.toContain("xcsh_blindfold");
		await session.prompt("Now prepare it offline");
		expect(hints(requests.at(-1)!)).toHaveLength(1);
		await session.prompt("New topic: write a poem");
		expect(hints(requests.at(-1)!)).toHaveLength(0);
		await session.prompt("Now prepare it offline");
		expect(hints(requests.at(-1)!)).toHaveLength(0);
	});
	it("keeps hints transient across repeated requests and synthetic turns", async () => {
		const { session, requests } = await create();
		await session.prompt("Explain BYOC");
		await session.prompt("Explain BYOC again");
		expect(hints(requests.at(-1)!)).toHaveLength(1);
		expect(
			session.messages.some(message => message.role === "custom" && message.customType === "blindfold-awareness"),
		).toBe(false);
		await session.prompt("Explain blindfold", { synthetic: true });
		expect(hints(requests.at(-1)!)).toHaveLength(0);
	});

	it("omits discovery when active and never advertises unavailable capabilities", async () => {
		for (const [available, active] of [
			[true, true],
			[false, false],
		]) {
			const { session, requests } = await create(available, active);
			await session.prompt("Explain BYOC");
			expect(hints(requests[0])).toHaveLength(available ? 1 : 0);
			if (available) expect(JSON.stringify(hints(requests[0]))).not.toContain("query:");
		}
	});
	it("ignores retrieved and agent-authored keyword occurrences", async () => {
		const { session, requests } = await create();
		await session.sendCustomMessage(
			{ customType: "retrieved-document", content: "BYOC blindfold private-key encryption", display: false },
			{ triggerTurn: true },
		);
		expect(hints(requests.at(-1)!)).toHaveLength(0);
		await session.prompt("Explain blindfold", { attribution: "agent" });
		expect(hints(requests.at(-1)!)).toHaveLength(0);
		await session.prompt("Summarize the article");
		expect(hints(requests.at(-1)!)).toHaveLength(0);
	});
	it("classifies only user text when embedded clients prepend retrieved context", async () => {
		const { session, requests } = await create();
		await session.prompt("Retrieved document: BYOC blindfold encryption. User task: summarize the article", {
			userTaskText: "Summarize the article",
		});
		expect(hints(requests.at(-1)!)).toHaveLength(0);
		await session.prompt("Office context. User task: prepare my custom certificate", {
			userTaskText: "Prepare my custom certificate",
		});
		expect(hints(requests.at(-1)!)).toHaveLength(1);
	});

	it("clears follow-up intent on session change and rediscovers explicit requests", async () => {
		const { session, requests } = await create();
		await session.prompt("Encrypt my private key");
		await session.newSession();
		await session.prompt("Now prepare it offline");
		expect(hints(requests.at(-1)!)).toHaveLength(0);
		await session.prompt("Explain blindfold");
		expect(hints(requests.at(-1)!)).toHaveLength(1);
	});
});
