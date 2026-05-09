import { describe, expect, it } from "bun:test";
import { transformMessages } from "../src/providers/transform-messages";
import type { AssistantMessage, Message, Model, StopReason, ToolResultMessage } from "../src/types";

function mockModel(): Model<"anthropic-messages"> {
	return {
		id: "test-model",
		name: "Test",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0 },
	} as Model<"anthropic-messages">;
}

function assistantWithToolCalls(
	toolCalls: { id: string; name: string }[],
	extra?: { text?: string; stopReason?: StopReason },
): AssistantMessage {
	const content: AssistantMessage["content"] = [];
	if (extra?.text) content.push({ type: "text", text: extra.text });
	for (const tc of toolCalls) {
		content.push({ type: "toolCall", id: tc.id, name: tc.name, arguments: {} });
	}
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: extra?.stopReason ?? "toolUse",
		timestamp: Date.now(),
	};
}

function toolResult(toolCallId: string, toolName: string, text = "done"): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	};
}

function userMessage(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

describe("transformMessages", () => {
	const model = mockModel();

	it("passes through correctly ordered tool_use/tool_result unchanged", () => {
		const messages: Message[] = [
			userMessage("go"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			toolResult("tc1", "read"),
		];
		const result = transformMessages(messages, model);
		expect(result).toHaveLength(3);
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("assistant");
		expect(result[2].role).toBe("toolResult");
		expect((result[2] as ToolResultMessage).toolCallId).toBe("tc1");
	});

	it("injects synthetic tool_result between consecutive assistant messages even when real result exists later", () => {
		const messages: Message[] = [
			userMessage("go"),
			assistantWithToolCalls([{ id: "tc1", name: "foo" }]),
			// No tool_result for tc1 here — consecutive assistants
			assistantWithToolCalls([{ id: "tc2", name: "bar" }], { text: "hello" }),
			toolResult("tc2", "bar", "bar result"),
			toolResult("tc1", "foo", "foo result"),
		];
		const result = transformMessages(messages, model);

		// Expected ordering:
		// user -> assistant[tc1] -> synthetic_toolResult[tc1] -> assistant[tc2] -> toolResult[tc2]
		// The real toolResult[tc1] should be dropped (already resolved by synthetic)

		// Find assistant messages
		const assistantIndices = result.map((m, i) => (m.role === "assistant" ? i : -1)).filter(i => i >= 0);
		expect(assistantIndices).toHaveLength(2);

		// After first assistant, there must be a toolResult for tc1 (synthetic)
		const afterFirstAssistant = result[assistantIndices[0] + 1];
		expect(afterFirstAssistant.role).toBe("toolResult");
		expect((afterFirstAssistant as ToolResultMessage).toolCallId).toBe("tc1");

		// After second assistant, there must be a toolResult for tc2 (real)
		const afterSecondAssistant = result[assistantIndices[1] + 1];
		expect(afterSecondAssistant.role).toBe("toolResult");
		expect((afterSecondAssistant as ToolResultMessage).toolCallId).toBe("tc2");

		// The duplicate real toolResult for tc1 should be dropped
		const tc1Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc1");
		expect(tc1Results).toHaveLength(1);
	});

	it("injects synthetic tool_result when tool_result is completely missing", () => {
		const messages: Message[] = [
			userMessage("go"),
			assistantWithToolCalls([{ id: "tc1", name: "bash" }]),
			// Process crashed — no tool_result at all
			userMessage("next turn"),
		];
		const result = transformMessages(messages, model);

		// Should have: user -> assistant[tc1] -> synthetic_toolResult[tc1] -> user
		expect(result[1].role).toBe("assistant");
		expect(result[2].role).toBe("toolResult");
		const synthetic = result[2] as ToolResultMessage;
		expect(synthetic.toolCallId).toBe("tc1");
		expect(synthetic.isError).toBe(true);
	});

	it("handles multiple tool calls in one assistant with only some results missing", () => {
		const messages: Message[] = [
			userMessage("go"),
			assistantWithToolCalls([
				{ id: "tc1", name: "read" },
				{ id: "tc2", name: "grep" },
			]),
			toolResult("tc1", "read"),
			// tc2 result missing — next assistant arrives
			assistantWithToolCalls([{ id: "tc3", name: "write" }], { text: "continuing" }),
			toolResult("tc3", "write"),
			toolResult("tc2", "grep", "late grep result"),
		];
		const result = transformMessages(messages, model);

		// After first assistant: tc1 result (real), tc2 result (synthetic before second assistant)
		// After second assistant: tc3 result (real)
		// Late tc2 result: dropped (already resolved by synthetic)

		const tc2Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc2");
		expect(tc2Results).toHaveLength(1);
		// The synthetic should be an error result
		expect((tc2Results[0] as ToolResultMessage).isError).toBe(true);
	});

	it("does not inject synthetic when tool_result immediately follows assistant", () => {
		const messages: Message[] = [
			userMessage("go"),
			assistantWithToolCalls([
				{ id: "tc1", name: "read" },
				{ id: "tc2", name: "grep" },
			]),
			toolResult("tc1", "read"),
			toolResult("tc2", "grep"),
			userMessage("thanks"),
		];
		const result = transformMessages(messages, model);

		// No synthetic results — all real results present
		const toolResults = result.filter(m => m.role === "toolResult");
		expect(toolResults).toHaveLength(2);
		expect(toolResults.every(r => !(r as ToolResultMessage).isError)).toBe(true);
	});

	it("developer message between tool_use and tool_result does not trigger flush", () => {
		const messages: Message[] = [
			userMessage("go"),
			assistantWithToolCalls([{ id: "tc1", name: "todo_write" }]),
			{
				role: "developer" as const,
				content: "Follow-up guidance",
				timestamp: Date.now(),
			},
			toolResult("tc1", "todo_write", "updated"),
		];
		const result = transformMessages(messages, model);

		// The real tool result should be preserved, no synthetic injected
		const toolResults = result.filter(m => m.role === "toolResult");
		expect(toolResults).toHaveLength(1);
		expect((toolResults[0] as ToolResultMessage).isError).toBe(false);
		expect((toolResults[0] as ToolResultMessage).toolCallId).toBe("tc1");
	});

	it("flushes orphaned tool calls at end of message array", () => {
		const messages: Message[] = [
			userMessage("go"),
			assistantWithToolCalls([
				{ id: "tc1", name: "read" },
				{ id: "tc2", name: "grep" },
			]),
			// Array ends here — no tool results, no user message
		];
		const result = transformMessages(messages, model);

		// Synthetics should be injected at end-of-array flush
		const toolResults = result.filter(m => m.role === "toolResult");
		expect(toolResults).toHaveLength(2);
		const ids = toolResults.map(r => (r as ToolResultMessage).toolCallId).sort();
		expect(ids).toEqual(["tc1", "tc2"]);
		for (const r of toolResults) {
			expect((r as ToolResultMessage).isError).toBe(true);
		}
	});

	it("handles consecutive aborted assistants without duplicating synthetics", () => {
		const messages: Message[] = [
			userMessage("go"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }], { stopReason: "aborted" }),
			// No result for tc1
			assistantWithToolCalls([{ id: "tc2", name: "grep" }], { stopReason: "aborted" }),
			// No result for tc2
			userMessage("continue"),
		];
		const result = transformMessages(messages, model);

		// Each aborted assistant should have exactly one synthetic tool result
		const tc1Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc1");
		const tc2Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc2");
		expect(tc1Results).toHaveLength(1);
		expect(tc2Results).toHaveLength(1);

		// Both should be error results
		expect((tc1Results[0] as ToolResultMessage).isError).toBe(true);
		expect((tc2Results[0] as ToolResultMessage).isError).toBe(true);

		// Should have developer guidance markers for aborted turns
		const devMessages = result.filter(m => m.role === "developer");
		expect(devMessages.length).toBeGreaterThanOrEqual(2);
	});

	it("strips thinking signatures from aborted assistant messages", () => {
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "let me reason",
						thinkingSignature: "partial-sig-aborted",
					},
					{ type: "text", text: "answer" },
					{ type: "toolCall", id: "tc1", name: "read", arguments: {} },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "aborted" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
		];
		const result = transformMessages(messages, model);
		const assistant = result.find(m => m.role === "assistant") as AssistantMessage;
		const thinking = assistant.content.find(b => b.type === "thinking");
		expect(thinking).toBeDefined();
		// Signature should be stripped for aborted messages
		expect((thinking as any).thinkingSignature).toBeUndefined();
		// Thinking text preserved
		expect((thinking as any).thinking).toBe("let me reason");
	});

	it("converts thinking to text when crossing model providers", () => {
		const differentModel = {
			...model,
			id: "different-model",
			provider: "different-provider",
		} as Model<"anthropic-messages">;
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "deep reasoning here" },
					{ type: "text", text: "answer" },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
			userMessage("next"),
			// A later assistant so the test target is NOT the latest (avoids mustPreserveLatestAnthropicThinking)
			assistantWithToolCalls([{ id: "tc-later", name: "read" }]),
			toolResult("tc-later", "read"),
		];
		const result = transformMessages(messages, differentModel);
		const assistants = result.filter(m => m.role === "assistant") as AssistantMessage[];
		const assistant = assistants[0]; // First assistant is the cross-model one
		// Thinking block should be converted to text type
		const thinkingBlocks = assistant.content.filter(b => b.type === "thinking");
		expect(thinkingBlocks).toHaveLength(0);
		const textBlocks = assistant.content.filter(b => b.type === "text");
		// One original text + one converted from thinking
		expect(textBlocks).toHaveLength(2);
		expect(textBlocks.some(b => (b as any).text === "deep reasoning here")).toBe(true);
	});

	it("removes empty thinking blocks from same-model messages without signatures", () => {
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "" },
					{ type: "thinking", thinking: "   " },
					{ type: "text", text: "answer" },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
			userMessage("next"),
			// Later assistant so test target is not the latest
			assistantWithToolCalls([{ id: "tc-later2", name: "grep" }]),
			toolResult("tc-later2", "grep"),
		];
		const result = transformMessages(messages, model);
		const assistants = result.filter(m => m.role === "assistant") as AssistantMessage[];
		const assistant = assistants[0]; // First assistant has the thinking blocks
		// Both empty thinking blocks should be removed
		const thinkingBlocks = assistant.content.filter(b => b.type === "thinking");
		expect(thinkingBlocks).toHaveLength(0);
		// Only the text block should remain
		expect(assistant.content).toHaveLength(1);
		expect(assistant.content[0].type).toBe("text");
	});

	it("normalizes tool call IDs and updates matching tool_result IDs", () => {
		const differentModel = {
			...model,
			id: "different-model",
			provider: "different-provider",
		} as Model<"anthropic-messages">;
		// Simulate OpenAI-style long IDs being normalized for Anthropic
		const normalizer = (id: string) => (id.length > 10 ? `norm_${id.slice(0, 8)}` : id);
		const longId = "openai_response_id_very_long_with_special_chars";
		const messages: Message[] = [
			userMessage("go"),
			assistantWithToolCalls([{ id: longId, name: "read" }]),
			toolResult(longId, "read"),
		];
		// Override the assistant's provider/model to trigger cross-model normalization
		(messages[1] as AssistantMessage).provider = "openai";
		(messages[1] as AssistantMessage).model = "gpt-4o";
		(messages[1] as AssistantMessage).api = "openai-responses";

		const result = transformMessages(messages, differentModel, normalizer);

		// The tool call ID should be normalized
		const assistant = result.find(m => m.role === "assistant") as AssistantMessage;
		const tc = assistant.content.find(b => b.type === "toolCall") as any;
		expect(tc.id).toBe(`norm_${longId.slice(0, 8)}`);

		// The tool result ID should also be normalized to match
		const tr = result.find(m => m.role === "toolResult") as ToolResultMessage;
		expect(tr.toolCallId).toBe(tc.id);
	});

	it("strips thoughtSignature from tool calls when crossing models", () => {
		const differentModel = {
			...model,
			id: "different-model",
			provider: "different-provider",
		} as Model<"anthropic-messages">;
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "tc1",
						name: "read",
						arguments: {},
						thoughtSignature: "encrypted-thought-data",
					},
				],
				api: "openai-responses",
				provider: "openai",
				model: "gpt-4o",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
			toolResult("tc1", "read"),
		];
		const result = transformMessages(messages, differentModel);
		const assistant = result.find(m => m.role === "assistant") as AssistantMessage;
		const tc = assistant.content.find(b => b.type === "toolCall") as any;
		expect(tc.thoughtSignature).toBeUndefined();
		expect(tc.name).toBe("read");
	});

	it("strips redactedThinking blocks when crossing models", () => {
		const differentModel = {
			...model,
			id: "different-model",
			provider: "different-provider",
		} as Model<"anthropic-messages">;
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [
					{ type: "redactedThinking", data: "encrypted-thinking-payload" },
					{ type: "text", text: "visible answer" },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
			userMessage("next"),
			// Later assistant so test target is not the latest
			assistantWithToolCalls([{ id: "tc-later", name: "read" }]),
			toolResult("tc-later", "read"),
		];
		const result = transformMessages(messages, differentModel);
		const assistants = result.filter(m => m.role === "assistant") as AssistantMessage[];
		const assistant = assistants[0];
		// redactedThinking should be stripped for cross-model
		const redacted = assistant.content.filter(b => b.type === "redactedThinking");
		expect(redacted).toHaveLength(0);
		// Text should be preserved
		const text = assistant.content.filter(b => b.type === "text");
		expect(text).toHaveLength(1);
		expect((text[0] as any).text).toBe("visible answer");
	});

	it("preserves thinking blocks (including signatures) on the latest Anthropic assistant", () => {
		// The latest assistant's thinking MUST be preserved for extended thinking API replay
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "deep reasoning",
						thinkingSignature: "valid-signature",
					},
					{ type: "text", text: "answer" },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
		];
		// This assistant IS the latest — thinking must be preserved
		const result = transformMessages(messages, model);
		const assistant = result.find(m => m.role === "assistant") as AssistantMessage;
		const thinking = assistant.content.find(b => b.type === "thinking");
		expect(thinking).toBeDefined();
		expect((thinking as any).thinkingSignature).toBe("valid-signature");
		expect((thinking as any).thinking).toBe("deep reasoning");
	});

	it("preserves signed thinking on non-latest same-model assistant for replay", () => {
		// Same model with signature: kept for replay even when not latest
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "earlier reasoning",
						thinkingSignature: "earlier-sig",
					},
					{ type: "text", text: "first answer" },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
			userMessage("next"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			toolResult("tc1", "read"),
		];
		const result = transformMessages(messages, model);
		const assistants = result.filter(m => m.role === "assistant") as AssistantMessage[];
		const first = assistants[0];
		// Same model + has signature → kept for replay
		const thinking = first.content.find(b => b.type === "thinking");
		expect(thinking).toBeDefined();
		expect((thinking as any).thinkingSignature).toBe("earlier-sig");
	});

	it("keeps same-model thinking without signature as thinking type (not converted to text)", () => {
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "non-signed reasoning" },
					{ type: "text", text: "answer" },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
			userMessage("next"),
			// Later assistant so test target is not the latest
			assistantWithToolCalls([{ id: "tc2", name: "grep" }]),
			toolResult("tc2", "grep"),
		];
		const result = transformMessages(messages, model);
		const assistants = result.filter(m => m.role === "assistant") as AssistantMessage[];
		const first = assistants[0];
		// Same model, no signature, non-empty text → preserved as thinking type
		const thinking = first.content.find(b => b.type === "thinking");
		expect(thinking).toBeDefined();
		expect((thinking as any).thinking).toBe("non-signed reasoning");
	});

	it("strips extra properties from text blocks when crossing models", () => {
		const differentModel = {
			...model,
			id: "different-model",
			provider: "different-provider",
		} as Model<"anthropic-messages">;
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [{ type: "text", text: "answer", citations: ["ref1"] } as any],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
			userMessage("next"),
			assistantWithToolCalls([{ id: "tc-later", name: "read" }]),
			toolResult("tc-later", "read"),
		];
		const result = transformMessages(messages, differentModel);
		const assistants = result.filter(m => m.role === "assistant") as AssistantMessage[];
		const first = assistants[0];
		const textBlock = first.content.find(b => b.type === "text") as any;
		expect(textBlock.text).toBe("answer");
		// Extra properties like 'citations' should be stripped
		expect(textBlock.citations).toBeUndefined();
		expect(Object.keys(textBlock).sort()).toEqual(["text", "type"]);
	});

	it("preserves redactedThinking on same-model messages", () => {
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [
					{ type: "redactedThinking", data: "encrypted-payload" },
					{ type: "text", text: "answer" },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
			userMessage("next"),
			assistantWithToolCalls([{ id: "tc-later", name: "read" }]),
			toolResult("tc-later", "read"),
		];
		const result = transformMessages(messages, model);
		const assistants = result.filter(m => m.role === "assistant") as AssistantMessage[];
		const first = assistants[0];
		// Same model: redactedThinking preserved
		const redacted = first.content.find(b => b.type === "redactedThinking");
		expect(redacted).toBeDefined();
		expect((redacted as any).data).toBe("encrypted-payload");
	});

	it("drops real tool result arriving after synthetic aborted was already flushed", () => {
		const messages: Message[] = [
			userMessage("go"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }], { stopReason: "aborted" }),
			// No real result for tc1 here
			userMessage("continue"),
			// Synthetic aborted result was flushed before this user message.
			// Now a late real result for tc1 arrives:
			toolResult("tc1", "read", "late real result"),
		];
		const result = transformMessages(messages, model);
		// tc1 should have exactly 1 result (the synthetic aborted)
		const tc1Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc1");
		expect(tc1Results).toHaveLength(1);
		// Should be the synthetic error, not the real one
		expect((tc1Results[0] as ToolResultMessage).isError).toBe(true);
		expect((tc1Results[0] as ToolResultMessage).content[0]).toEqual({ type: "text", text: "aborted" });
	});

	it("flushes first aborted assistant calls when second aborted assistant arrives", () => {
		// Two aborted assistants back-to-back: the second triggers flush of the first
		const messages: Message[] = [
			userMessage("go"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }], { stopReason: "aborted" }),
			// Second aborted assistant arrives before any result for tc1
			assistantWithToolCalls([{ id: "tc2", name: "grep" }], { stopReason: "error" }),
			userMessage("done"),
		];
		const result = transformMessages(messages, model);

		// Both tc1 and tc2 should have synthetic aborted results
		const tc1Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc1");
		const tc2Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc2");
		expect(tc1Results).toHaveLength(1);
		expect(tc2Results).toHaveLength(1);
		expect((tc1Results[0] as ToolResultMessage).isError).toBe(true);
		expect((tc2Results[0] as ToolResultMessage).isError).toBe(true);

		// Should have 2 developer guidance markers (one per aborted flush)
		const devMessages = result.filter(m => m.role === "developer");
		expect(devMessages).toHaveLength(2);
	});

	it("preserves pendingAbortedToolCalls real results even when second aborted arrives", () => {
		// First aborted assistant, real result arrives, then second aborted assistant
		const messages: Message[] = [
			userMessage("go"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }], { stopReason: "aborted" }),
			toolResult("tc1", "read", "real result for tc1"),
			assistantWithToolCalls([{ id: "tc2", name: "grep" }], { stopReason: "error" }),
			userMessage("done"),
		];
		const result = transformMessages(messages, model);

		// tc1 has real result (arrived before flush)
		const tc1Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc1");
		expect(tc1Results).toHaveLength(1);
		expect((tc1Results[0] as ToolResultMessage).isError).toBe(false);
		expect((tc1Results[0] as ToolResultMessage).content[0]).toEqual({ type: "text", text: "real result for tc1" });

		// tc2 has synthetic aborted result
		const tc2Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc2");
		expect(tc2Results).toHaveLength(1);
		expect((tc2Results[0] as ToolResultMessage).isError).toBe(true);
	});

	it("strips thinking signatures from errored (not just aborted) assistant messages", () => {
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "reasoning before error",
						thinkingSignature: "partial-sig-error",
					},
					{ type: "text", text: "partial answer" },
					{ type: "toolCall", id: "tc1", name: "read", arguments: {} },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "error" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
		];
		const result = transformMessages(messages, model);
		const assistant = result.find(m => m.role === "assistant") as AssistantMessage;
		const thinking = assistant.content.find(b => b.type === "thinking");
		expect(thinking).toBeDefined();
		expect((thinking as any).thinkingSignature).toBeUndefined();
		expect((thinking as any).thinking).toBe("reasoning before error");
	});

	it("preserves empty thinking with signature on same model (OpenAI encrypted reasoning)", () => {
		// OpenAI encrypted reasoning produces empty thinking text but with a signature
		// that must be preserved for replay
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "",
						thinkingSignature: "encrypted-reasoning-sig",
					},
					{ type: "text", text: "answer" },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
			userMessage("next"),
			assistantWithToolCalls([{ id: "tc-later", name: "read" }]),
			toolResult("tc-later", "read"),
		];
		const result = transformMessages(messages, model);
		const assistants = result.filter(m => m.role === "assistant") as AssistantMessage[];
		const first = assistants[0];
		// Empty thinking with signature: kept for same model (encrypted reasoning)
		const thinking = first.content.find(b => b.type === "thinking");
		expect(thinking).toBeDefined();
		expect((thinking as any).thinkingSignature).toBe("encrypted-reasoning-sig");
		expect((thinking as any).thinking).toBe("");
	});

	it("preserves redactedThinking on latest Anthropic assistant for extended thinking replay", () => {
		// The latest Anthropic assistant MUST preserve redactedThinking blocks
		// for the extended thinking API to work correctly
		const messages: Message[] = [
			userMessage("go"),
			{
				role: "assistant",
				content: [
					{ type: "redactedThinking", data: "encrypted-extended-thinking" },
					{ type: "text", text: "final answer" },
				],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop" as const,
				timestamp: Date.now(),
			} as AssistantMessage,
			// This IS the latest assistant — redactedThinking MUST be preserved
		];
		const result = transformMessages(messages, model);
		const assistant = result.find(m => m.role === "assistant") as AssistantMessage;
		const redacted = assistant.content.find(b => b.type === "redactedThinking");
		expect(redacted).toBeDefined();
		expect((redacted as any).data).toBe("encrypted-extended-thinking");
	});

	it("handles complex corrupted session: aborted + normal + orphan all in one", () => {
		// Simulates a realistic corruption scenario:
		// 1. Normal assistant with tool calls and results (clean)
		// 2. Aborted assistant with tool calls (no results yet)
		// 3. Real result for aborted tool call arrives
		// 4. Normal assistant with tool calls
		// 5. Missing result for normal tool call
		// 6. User turn
		const messages: Message[] = [
			userMessage("step 1"),
			assistantWithToolCalls([{ id: "clean-tc", name: "read" }]),
			toolResult("clean-tc", "read", "clean result"),
			userMessage("step 2"),
			assistantWithToolCalls([{ id: "abort-tc", name: "bash" }], { stopReason: "aborted" }),
			toolResult("abort-tc", "bash", "completed before abort"),
			userMessage("step 3"),
			assistantWithToolCalls([
				{ id: "orphan-tc1", name: "grep" },
				{ id: "orphan-tc2", name: "find" },
			]),
			// Only one of two results provided:
			toolResult("orphan-tc1", "grep", "found it"),
			// orphan-tc2 is missing
			userMessage("step 4"),
		];
		const result = transformMessages(messages, model);

		// Verify no API-breaking issues in output:
		// 1. Every assistant is followed by toolResults
		// 2. No consecutive assistants without intervening toolResults
		// 3. No duplicate toolResults for same ID
		const allToolCallIds = new Set<string>();
		let lastRole = "";
		for (const msg of result) {
			if (msg.role === "assistant") {
				expect(lastRole).not.toBe("assistant"); // no consecutive assistants
			}
			if (msg.role === "toolResult") {
				const id = (msg as ToolResultMessage).toolCallId;
				expect(allToolCallIds.has(id)).toBe(false); // no duplicates
				allToolCallIds.add(id);
			}
			lastRole = msg.role;
		}

		// All tool calls should be resolved
		expect(allToolCallIds.has("clean-tc")).toBe(true);
		expect(allToolCallIds.has("abort-tc")).toBe(true);
		expect(allToolCallIds.has("orphan-tc1")).toBe(true);
		expect(allToolCallIds.has("orphan-tc2")).toBe(true);
	});
});
