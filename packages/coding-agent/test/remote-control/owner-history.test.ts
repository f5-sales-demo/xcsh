import { expect, test } from "bun:test";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { RemoteSession } from "../../src/remote-control/session";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

test("the real AgentSession owns tool execution and message persistence with matching remote history", async () => {
	const model = getBundledModel("openai", "gpt-4o-mini")!;
	const auth = await AuthStorage.create(":memory:");
	auth.setRuntimeApiKey(model.provider, "fixture-key");
	let executions = 0;
	let iteration = 0;
	const agent = new Agent({
		getApiKey: () => "fixture-key",
		initialState: {
			model,
			systemPrompt: "Test",
			messages: [],
			tools: [
				{
					name: "fixture",
					label: "Fixture",
					description: "Fixture tool",
					parameters: Type.Object({}),
					execute: async () => {
						executions++;
						return { content: [{ type: "text", text: "tool result" }], details: {} };
					},
				},
			],
		},
		streamFn: () => {
			const stream = new AssistantMessageEventStream();
			const first = ++iteration === 1;
			const message: AssistantMessage = {
				role: "assistant",
				content: first
					? [{ type: "toolCall", id: "owner-call", name: "fixture", arguments: {} }]
					: [{ type: "text", text: "Owner finished", phase: "final_answer" }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				stopReason: first ? "toolUse" : "stop",
				timestamp: Date.now(),
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
				stream.push({ type: "done", reason: first ? "toolUse" : "stop", message });
			});
			return stream;
		},
	});
	const manager = SessionManager.inMemory();
	const session = new AgentSession({
		agent,
		sessionManager: manager,
		settings: Settings.isolated({ "compaction.enabled": false }),
		modelRegistry: new ModelRegistry(auth),
	});
	const remote = new RemoteSession(session);
	const completed = Promise.withResolvers<unknown>();
	const items: Record<string, unknown>[] = [];
	remote.subscribe(event => {
		if (event.method === "item/completed") items.push(event.params.item as Record<string, unknown>);
		if (event.method === "turn/completed") completed.resolve(event.params.turn);
	});
	try {
		const params = {
			threadId: session.sessionId,
			clientUserMessageId: "owner-prompt",
			input: [{ type: "text", text: "Use the fixture" }],
		};
		const start = await remote.call("owner", "turn/start", params);
		expect(await remote.call("owner", "turn/start", params)).toEqual(start);
		await completed.promise;
		await manager.flush();
		const history = remote.history();
		expect(executions).toBe(1);
		expect(history).toHaveLength(1);
		expect(history[0].items.map(item => item.type)).toEqual(["userMessage", "dynamicToolCall", "agentMessage"]);
		expect(history[0].items).toEqual(items);
		expect(await completed.promise).toEqual(history[0]);
		expect(manager.getBranch().filter(entry => entry.type === "message")).toHaveLength(4);
		remote.dispose();
		const reattached = new RemoteSession(session);
		try {
			expect(reattached.history()).toEqual(history);
		} finally {
			reattached.dispose();
		}
	} finally {
		remote.dispose();
		await session.dispose();
		auth.close();
	}
});
