import { describe, expect, it } from "bun:test";
import type { AssistantMessage, Model, SimpleStreamOptions } from "@f5-sales-demo/pi-ai";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { agentLoop } from "../src/agent-loop";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types";

const model = getBundledModel("openai", "gpt-4o-mini")!;
const forcedChoice = { type: "function", name: "xcsh_context" } as const;

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
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

function response(message: AssistantMessage): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	queueMicrotask(() => {
		stream.push({ type: "start", partial: assistant([], message.stopReason) });
		for (const [contentIndex, content] of message.content.entries()) {
			if (content.type === "text") {
				stream.push({ type: "text_start", contentIndex, partial: message });
				stream.push({ type: "text_delta", contentIndex, delta: content.text, partial: message });
				stream.push({ type: "text_end", contentIndex, content: content.text, partial: message });
			} else if (content.type === "toolCall") {
				stream.push({ type: "toolcall_start", contentIndex, partial: message });
				stream.push({ type: "toolcall_end", contentIndex, toolCall: content, partial: message });
			}
		}
		if (message.stopReason === "aborted" || message.stopReason === "error") {
			stream.push({ type: "error", reason: message.stopReason, error: message });
		} else {
			stream.push({ type: "done", reason: message.stopReason, message });
		}
	});
	return stream;
}

function createHarness(messages: AssistantMessage[], signal?: AbortSignal) {
	const calls: Array<SimpleStreamOptions["toolChoice"]> = [];
	const requestMessages: string[][] = [];
	const invocations: Array<{ name: string; contextName?: string }> = [];
	const events: AgentEvent[] = [];
	const interceptedUpdates: string[] = [];
	let responseIndex = 0;
	let directiveAvailable = true;
	const tool = (name: string): AgentTool => ({
		name,
		label: name,
		description: name,
		parameters: Type.Object({ name: Type.Optional(Type.String()) }),
		execute: async (_id, args) => {
			invocations.push({ name, contextName: (args as { name?: string }).name });
			return { content: [{ type: "text", text: "ok" }], details: {} };
		},
	});
	const context: AgentContext = {
		systemPrompt: "Test",
		messages: [],
		tools: [tool("xcsh_context"), tool("xcsh_api")],
	};
	const config: AgentLoopConfig = {
		model,
		convertToLlm: value => value as never,
		onAssistantMessageEvent: message => interceptedUpdates.push(JSON.stringify(message)),
		getToolChoice: () => {
			if (!directiveAvailable) return undefined;
			directiveAvailable = false;
			return forcedChoice;
		},
	};
	const stream = agentLoop(
		[{ role: "user", content: "Apply the intended context.", timestamp: 1 }],
		context,
		config,
		signal,
		(_model: Model, requestContext, options) => {
			calls.push(options?.toolChoice);
			requestMessages.push(
				requestContext.messages.map(message =>
					typeof message.content === "string"
						? message.content
						: message.content.map(content => (content.type === "text" ? content.text : "")).join(""),
				),
			);
			return response(messages[responseIndex++]!);
		},
	);
	const run = async (): Promise<AgentMessage[]> => {
		for await (const event of stream) events.push(event);
		return await stream.result();
	};
	return { calls, context, events, interceptedUpdates, invocations, requestMessages, run };
}

describe("exact named tool choice", () => {
	it("buffers a pre-invocation length stop and retries once with the same choice", async () => {
		const harness = createHarness([
			assistant([{ type: "text", text: "PRIVATE_INCOMPLETE" }], "length"),
			assistant(
				[{ type: "toolCall", id: "context-call", name: "xcsh_context", arguments: { name: "intended" } }],
				"toolUse",
			),
			assistant([{ type: "text", text: "done" }], "stop"),
		]);

		const result = await harness.run();

		expect(harness.calls.slice(0, 2)).toEqual([forcedChoice, forcedChoice]);
		expect(harness.calls[1]).toBe(harness.calls[0]);
		expect(harness.requestMessages[0]).not.toContain(
			"The previous response ended before the required tool call. Call xcsh_context now without explanatory text.",
		);
		expect(harness.requestMessages[1]).toContain(
			"The previous response ended before the required tool call. Call xcsh_context now without explanatory text.",
		);
		expect(harness.invocations).toEqual([{ name: "xcsh_context", contextName: "intended" }]);
		expect(JSON.stringify(harness.events)).not.toContain("PRIVATE_INCOMPLETE");
		expect(JSON.stringify(harness.interceptedUpdates)).not.toContain("PRIVATE_INCOMPLETE");
		expect(JSON.stringify(result)).not.toContain("PRIVATE_INCOMPLETE");
		expect(JSON.stringify(result)).not.toContain("The previous response ended before the required tool call.");
	});

	it("returns a sanitized failure when the bounded retry also stops for length", async () => {
		const harness = createHarness([
			assistant([{ type: "text", text: "PRIVATE_FIRST" }], "length"),
			assistant([{ type: "text", text: "PRIVATE_SECOND" }], "length"),
		]);

		const result = await harness.run();

		expect(harness.calls).toEqual([forcedChoice, forcedChoice]);
		expect(harness.invocations).toEqual([]);
		expect(JSON.stringify(harness.events)).not.toMatch(/PRIVATE_(?:FIRST|SECOND)/u);
		expect(JSON.stringify(result)).not.toMatch(/PRIVATE_(?:FIRST|SECOND)/u);
		const failure = result.find(message => message.role === "assistant") as AssistantMessage;
		expect(failure.stopReason).toBe("error");
		expect(failure.errorMessage).toBe("Required tool invocation failed.");
	});

	it("rejects a substituted tool without executing a wrong-tenant request", async () => {
		const harness = createHarness([
			assistant(
				[{ type: "toolCall", id: "wrong-call", name: "xcsh_api", arguments: { name: "wrong-tenant" } }],
				"toolUse",
			),
		]);

		const result = await harness.run();

		expect(harness.calls).toEqual([forcedChoice]);
		expect(harness.invocations).toEqual([]);
		expect(JSON.stringify(harness.events)).not.toContain("wrong-tenant");
		expect(JSON.stringify(result)).not.toContain("wrong-tenant");
	});

	it("aborts normally without retrying or invoking a tool", async () => {
		const abortController = new AbortController();
		abortController.abort();
		const harness = createHarness(
			[assistant([{ type: "text", text: "PRIVATE_ABORTED" }], "length")],
			abortController.signal,
		);

		const result = await harness.run();

		expect(harness.calls).toHaveLength(1);
		expect(harness.invocations).toEqual([]);
		expect(JSON.stringify(harness.events)).not.toContain("PRIVATE_ABORTED");
		const aborted = result.find(message => message.role === "assistant") as AssistantMessage;
		expect(aborted.stopReason).toBe("aborted");
	});
});
