import { expect, test } from "bun:test";
import { type AssistantMessage, getBundledModel, type Message } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { agentLoop } from "../src/agent-loop";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage } from "../src/types";

test.each([false, true])("context messages persist across tool calls and pruning=%s", async prune => {
	const model = getBundledModel("openai", "gpt-4o-mini")!;
	const requests: Message[][] = [];
	const events: AgentEvent[] = [];
	let executions = 0;
	const context: AgentContext = {
		systemPrompt: "Fixture",
		messages: [],
		tools: [
			{
				name: "fixture",
				label: "Fixture",
				description: "Fixture",
				parameters: Type.Object({}),
				execute: async () => {
					executions++;
					return { content: [{ type: "text", text: "done" }], details: {} };
				},
			},
		],
	};
	const config: AgentLoopConfig = {
		model,
		convertToLlm: messages => messages as Message[],
		transformContext: async messages => (prune ? messages.filter(message => message.role !== "developer") : messages),
		getContextMessages: messages =>
			messages.some(message => message.role === "developer")
				? []
				: [
						{
							role: "developer",
							content: [{ type: "text", text: "Fixture context" }],
							timestamp: 123,
						},
					],
	};
	const stream = agentLoop(
		[{ role: "user", content: "fixture", timestamp: 1 }],
		context,
		config,
		undefined,
		(_model, request) => {
			requests.push([...request.messages]);
			const out = new AssistantMessageEventStream();
			const message: AssistantMessage = {
				role: "assistant",
				api: model.api,
				provider: model.provider,
				model: model.id,
				timestamp: Date.now(),
				content:
					requests.length === 1
						? [{ type: "toolCall", id: "fixture-call", name: "fixture", arguments: {} }]
						: [{ type: "text", text: "done" }],
				stopReason: requests.length === 1 ? "toolUse" : "stop",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
			queueMicrotask(() =>
				out.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }),
			);
			return out;
		},
	);
	for await (const event of stream) events.push(event);
	expect(executions).toBe(1);
	expect(requests).toHaveLength(2);
	for (const request of requests) expect(request.filter(message => message.role === "developer")).toHaveLength(1);
	const ended = events.filter(event => event.type === "message_end" && event.message.role === "developer");
	expect(ended).toHaveLength(prune ? 2 : 1);
	const result: AgentMessage[] = await stream.result();
	expect(result.filter(message => message.role === "developer")).toHaveLength(prune ? 2 : 1);
});
