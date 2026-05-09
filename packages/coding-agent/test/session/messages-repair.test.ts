import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@f5xc-salesdemos/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@f5xc-salesdemos/pi-ai";
import { convertToLlm } from "../../src/session/messages";

function userMessage(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function assistantWithToolCalls(toolCalls: { id: string; name: string }[]): AgentMessage {
	return {
		role: "assistant",
		content: toolCalls.map(tc => ({
			type: "toolCall" as const,
			id: tc.id,
			name: tc.name,
			arguments: {},
		})),
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
		stopReason: "toolUse",
		timestamp: Date.now(),
	} as AssistantMessage;
}

function toolResult(toolCallId: string, toolName: string, text = "done"): AgentMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	} as ToolResultMessage;
}

function customMessage(text: string): AgentMessage {
	return {
		role: "custom" as AgentMessage["role"],
		customType: "test-injection",
		content: text,
		display: false,
		timestamp: Date.now(),
	} as AgentMessage;
}

describe("convertToLlm tool_result ordering repair", () => {
	it("passes through correctly ordered messages unchanged", () => {
		const messages: AgentMessage[] = [
			userMessage("do something"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			toolResult("tc1", "read"),
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(3);
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("assistant");
		expect(result[2].role).toBe("toolResult");
		expect((result[2] as ToolResultMessage).toolCallId).toBe("tc1");
	});

	it("repairs custom message wedged between tool_use and tool_result", () => {
		const messages: AgentMessage[] = [
			userMessage("do something"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			customMessage("injected system reminder"),
			toolResult("tc1", "read"),
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(4);
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("assistant");
		expect(result[2].role).toBe("toolResult");
		expect((result[2] as ToolResultMessage).toolCallId).toBe("tc1");
		expect(result[3].role).toBe("user");
	});

	it("injects synthetic tool_result when tool_result is missing entirely", () => {
		const messages: AgentMessage[] = [
			userMessage("do something"),
			assistantWithToolCalls([{ id: "tc1", name: "bash" }]),
			userMessage("next turn"),
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(4);
		expect(result[1].role).toBe("assistant");
		expect(result[2].role).toBe("toolResult");
		const syntheticResult = result[2] as ToolResultMessage;
		expect(syntheticResult.toolCallId).toBe("tc1");
		expect(syntheticResult.toolName).toBe("bash");
		expect(syntheticResult.isError).toBe(true);
		expect(result[3].role).toBe("user");
	});

	it("repairs multiple tool calls with interleaved non-tool messages", () => {
		const messages: AgentMessage[] = [
			userMessage("multi-tool"),
			assistantWithToolCalls([
				{ id: "tc1", name: "read" },
				{ id: "tc2", name: "grep" },
			]),
			customMessage("injected"),
			toolResult("tc1", "read"),
			toolResult("tc2", "grep"),
		];
		const result = convertToLlm(messages);
		expect(result[1].role).toBe("assistant");
		expect(result[2].role).toBe("toolResult");
		expect(result[3].role).toBe("toolResult");
		const ids = [result[2], result[3]].map(r => (r as ToolResultMessage).toolCallId).sort();
		expect(ids).toEqual(["tc1", "tc2"]);
	});

	it("handles tool_result found later in the array (out of position)", () => {
		const messages: AgentMessage[] = [
			userMessage("start"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			userMessage("user typed during execution"),
			userMessage("another message"),
			toolResult("tc1", "read"),
		];
		const result = convertToLlm(messages);
		expect(result[1].role).toBe("assistant");
		expect(result[2].role).toBe("toolResult");
		expect((result[2] as ToolResultMessage).toolCallId).toBe("tc1");
	});

	it("preserves messages with no tool calls", () => {
		const messages: AgentMessage[] = [
			userMessage("hello"),
			{
				role: "assistant",
				content: [{ type: "text", text: "hi there" }],
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
				stopReason: "stop",
				timestamp: Date.now(),
			} as AssistantMessage,
			userMessage("thanks"),
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(3);
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("assistant");
		expect(result[2].role).toBe("user");
	});
});
