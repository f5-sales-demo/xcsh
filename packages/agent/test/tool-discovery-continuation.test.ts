import { describe, expect, it } from "bun:test";
import type { AssistantMessage, Message, ToolResultMessage } from "@f5-sales-demo/pi-ai";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { agentLoop, agentLoopContinue } from "../src/agent-loop";
import type { AgentContext, AgentTool } from "../src/types";

const model = getBundledModel("openai", "gpt-6.1-sol");
const call = {
	type: "toolCall" as const,
	id: "call_synthetic|ts_synthetic",
	name: "search_tool_bm25",
	toolSearch: true,
	arguments: { query: "read" },
};
const assistant = (calls: boolean): AssistantMessage => ({
	role: "assistant",
	model: model.id,
	provider: model.provider,
	api: model.api,
	content: calls ? [call, call] : [{ type: "text", text: "done" }],
	stopReason: calls ? "toolUse" : "stop",
	timestamp: 0,
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
});

describe("client tool discovery continuation", () => {
	it("persists a fresh result when a provider reuses a call ID with different arguments", async () => {
		let requests = 0;
		let seen: Message[] = [];
		const changed = { ...call, arguments: { query: "write" } };
		const context: AgentContext = {
			systemPrompt: "",
			messages: [
				assistant(true),
				{
					role: "toolResult",
					toolName: call.name,
					toolCallId: call.id,
					content: [{ type: "text", text: "old" }],
					isError: false,
					timestamp: 1,
				},
			],
			tools: [
				{
					name: call.name,
					label: "Search",
					description: "Search",
					parameters: Type.Object({ query: Type.String() }),
					execute: async () => ({ content: [{ type: "text", text: "fresh" }] }),
				},
			],
		};
		const run = agentLoopContinue(
			context,
			{ model, convertToLlm: messages => messages as Message[] },
			undefined,
			(_model, context) => {
				seen = context.messages;
				const response = new AssistantMessageEventStream();
				const message = requests++ === 0 ? { ...assistant(true), content: [changed] } : assistant(false);
				queueMicrotask(() =>
					response.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }),
				);
				return response;
			},
		);
		for await (const _ of run) {
		}
		expect(
			seen.some(
				message =>
					message.role === "toolResult" &&
					message.content.some(part => part.type === "text" && part.text === "fresh"),
			),
		).toBe(true);
	});
	it("continues accepted live steering and accepts normalized user content blocks", async () => {
		let requests = 0;
		let queued = false;
		const restored: unknown[] = [];
		const context: AgentContext = { messages: [], systemPrompt: "", tools: [] };
		const stream = agentLoop(
			[{ role: "user", content: "synthetic", timestamp: 0 }],
			context,
			{
				model: { ...model, compat: { supportsWebSocketSteering: true } },
				convertToLlm: messages =>
					(messages as Message[]).map(message =>
						message.role === "user"
							? { ...message, content: [{ type: "text", text: String(message.content) }] }
							: message,
					),
				waitForSteeringMessages: async () => {},
				getSteeringMessages: async () => {
					if (!queued) return [];
					queued = false;
					return [{ role: "user", content: "steer", timestamp: 1 }];
				},
				restoreSteeringMessages: messages => {
					restored.push(...messages);
				},
			},
			undefined,
			(_model, _context, options) => {
				const response = new AssistantMessageEventStream();
				queueMicrotask(async () => {
					if (requests++ === 0) {
						queued = true;
						const claim = await options?.liveSteering?.claim(new AbortController().signal);
						claim?.accept();
					}
					const message = assistant(false);
					response.push({ type: "done", reason: "stop", message });
				});
				return response;
			},
		);
		for await (const _ of stream) {
		}
		expect(requests).toBe(2);
		expect(restored).toEqual([]);
	});
	it("correlated async replies stay queued for the model boundary rather than live steering", async () => {
		const reply = {
			role: "user" as const,
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({ type: "user_input_reply", itemId: "i", questionId: "i:0", answer: "B" }),
				},
			],
			timestamp: 1,
		};
		let queue: (typeof reply)[] = [];
		let requests = 0;
		let claimed = false;
		let received = false;
		const run = agentLoop(
			[{ role: "user", content: "Choose before producing the result", timestamp: 0 }],
			{ messages: [], systemPrompt: "", tools: [] },
			{
				model: { ...model, compat: { supportsWebSocketSteering: true } },
				convertToLlm: messages => messages as Message[],
				waitForSteeringMessages: async () => {},
				getSteeringMessages: async () => {
					const batch = queue;
					queue = [];
					return batch;
				},
				restoreSteeringMessages: messages => {
					queue.unshift(...(messages as (typeof reply)[]));
				},
			},
			undefined,
			(_model, context, options) => {
				const response = new AssistantMessageEventStream();
				queueMicrotask(async () => {
					if (requests++ === 0) {
						queue.push(reply);
						const claim = await options?.liveSteering?.claim(new AbortController().signal);
						claimed = !!claim;
						claim?.accept();
					} else
						received = context.messages.some(
							message =>
								message.role === "user" && JSON.stringify(message.content) === JSON.stringify(reply.content),
						);
					response.push({ type: "done", reason: "stop", message: assistant(false) });
				});
				return response;
			},
		);
		for await (const _ of run) {
		}
		expect(claimed).toBe(false);
		expect(received).toBe(true);
		expect(requests).toBe(2);
	});

	it("executes a repeated search once and persists activated schemas for replay", async () => {
		let executions = 0;
		const loaded = { name: "read", description: "Read", parameters: Type.Object({ path: Type.String() }) };
		const tool: AgentTool = {
			name: call.name,
			label: "Search",
			description: "Search",
			parameters: Type.Object({ query: Type.String() }),
			execute: async () => {
				executions++;
				return { content: [{ type: "text", text: "loaded" }], tools: [loaded] };
			},
		};
		let requests = 0;
		let result: ToolResultMessage | undefined;
		const stream = agentLoop(
			[{ role: "user", content: "synthetic", timestamp: 0 }],
			{ messages: [], systemPrompt: "", tools: [tool] },
			{ model, convertToLlm: messages => messages as Message[] },
			undefined,
			(_model, context) => {
				if (requests) result = context.messages.find(message => message.role === "toolResult") as ToolResultMessage;
				const response = new AssistantMessageEventStream();
				const message = assistant(requests++ === 0);
				queueMicrotask(() =>
					response.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }),
				);
				return response;
			},
		);
		for await (const _ of stream) {
		}
		expect(executions).toBe(1);
		expect(result).toMatchObject({ toolSearch: true, tools: [loaded], toolCallId: call.id });
	});
	it("preserves completed results during continuation without reexecuting the call", async () => {
		let executions = 0;
		let requests = 0;
		const existing: ToolResultMessage = {
			role: "toolResult",
			toolName: call.name,
			toolCallId: call.id,
			toolSearch: true,
			tools: [],
			content: [{ type: "text", text: "completed" }],
			isError: false,
			timestamp: 1,
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [assistant(true), existing],
			tools: [
				{
					name: call.name,
					label: "Search",
					description: "Search",
					parameters: Type.Object({ query: Type.String() }),
					execute: async () => {
						executions++;
						return { content: [] };
					},
				},
			],
		};
		const stream = agentLoopContinue(
			context,
			{ model, convertToLlm: messages => messages as Message[] },
			undefined,
			() => {
				const response = new AssistantMessageEventStream();
				const message = assistant(requests++ === 0);
				queueMicrotask(() =>
					response.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }),
				);
				return response;
			},
		);
		for await (const _ of stream) {
		}
		expect(executions).toBe(0);
	});
});
