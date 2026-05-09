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
});
