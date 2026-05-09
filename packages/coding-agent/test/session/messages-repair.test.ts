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

	it("injects synthetic results for ALL tool calls when none exist", () => {
		const messages: AgentMessage[] = [
			userMessage("multi-tool"),
			assistantWithToolCalls([
				{ id: "tc1", name: "read" },
				{ id: "tc2", name: "grep" },
				{ id: "tc3", name: "find" },
			]),
			userMessage("next turn"),
		];
		const result = convertToLlm(messages);
		// assistant -> 3 synthetic toolResults -> user
		const toolResults = result.filter(m => m.role === "toolResult");
		expect(toolResults).toHaveLength(3);
		const ids = toolResults.map(r => (r as ToolResultMessage).toolCallId).sort();
		expect(ids).toEqual(["tc1", "tc2", "tc3"]);
		for (const r of toolResults) {
			expect((r as ToolResultMessage).isError).toBe(true);
		}
	});

	it("repairs two consecutive assistant messages each missing results", () => {
		const messages: AgentMessage[] = [
			userMessage("start"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			assistantWithToolCalls([{ id: "tc2", name: "grep" }]),
			userMessage("end"),
		];
		const result = convertToLlm(messages);
		// Each assistant should be followed by its synthetic result
		const toolResults = result.filter(m => m.role === "toolResult");
		expect(toolResults).toHaveLength(2);
		const tc1Result = toolResults.find(r => (r as ToolResultMessage).toolCallId === "tc1");
		const tc2Result = toolResults.find(r => (r as ToolResultMessage).toolCallId === "tc2");
		expect(tc1Result).toBeDefined();
		expect(tc2Result).toBeDefined();
		expect((tc1Result as ToolResultMessage).isError).toBe(true);
		expect((tc2Result as ToolResultMessage).isError).toBe(true);
	});

	it("does not double-place tool_result when repair relocates it", () => {
		// tc1's result appears after another assistant + user message
		const messages: AgentMessage[] = [
			userMessage("start"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			userMessage("user typed during tool execution"),
			assistantWithToolCalls([{ id: "tc2", name: "grep" }]),
			toolResult("tc2", "grep"),
			toolResult("tc1", "read", "late result"),
		];
		const result = convertToLlm(messages);
		// tc1 result should appear exactly once
		const tc1Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc1");
		expect(tc1Results).toHaveLength(1);
		// tc2 result should appear exactly once
		const tc2Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc2");
		expect(tc2Results).toHaveLength(1);
	});

	it("handles compaction boundary: tool_result separated by compaction summary", () => {
		// Simulates compaction happening mid-tool-execution: assistant has tool_use,
		// compaction summary (converted to user message) gets inserted, then tool_result
		const messages: AgentMessage[] = [
			userMessage("do work"),
			assistantWithToolCalls([{ id: "tc1", name: "bash" }]),
			customMessage("compaction boundary"),
			customMessage("more injected context"),
			toolResult("tc1", "bash"),
		];
		const result = convertToLlm(messages);
		// tool_result should be relocated to immediately after assistant
		expect(result[1].role).toBe("assistant");
		expect(result[2].role).toBe("toolResult");
		expect((result[2] as ToolResultMessage).toolCallId).toBe("tc1");
		expect((result[2] as ToolResultMessage).isError).toBe(false);
	});

	it("repairs displaced assistant whose tool_result exists later in array", () => {
		// assistant[tc1] displaces assistant[tc2] during repair.
		// tc2's real result exists later — first pass relocates it to tc1,
		// second pass verifies tc2 is resolved.
		const messages: AgentMessage[] = [
			userMessage("start"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			assistantWithToolCalls([{ id: "tc2", name: "grep" }]),
			toolResult("tc1", "read", "tc1 result"),
			toolResult("tc2", "grep", "tc2 result"),
		];
		const result = convertToLlm(messages);

		// Both tool_results should appear exactly once
		const tc1Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc1");
		const tc2Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc2");
		expect(tc1Results).toHaveLength(1);
		expect(tc2Results).toHaveLength(1);

		// Verify ordering: each assistant followed by its tool_result
		const assistantIndices = result.map((m, i) => (m.role === "assistant" ? i : -1)).filter(i => i >= 0);
		expect(assistantIndices).toHaveLength(2);
		for (const idx of assistantIndices) {
			expect(result[idx + 1]?.role).toBe("toolResult");
		}
	});
});

describe("convertToLlm message type conversions", () => {
	it("excludes bashExecution messages with excludeFromContext", () => {
		const messages: AgentMessage[] = [
			userMessage("start"),
			{
				role: "bashExecution" as AgentMessage["role"],
				command: "secret-command",
				output: "secret output",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				excludeFromContext: true,
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1); // Only the user message
		expect(result[0].role).toBe("user");
	});

	it("converts bashExecution to user message when not excluded", () => {
		const messages: AgentMessage[] = [
			{
				role: "bashExecution" as AgentMessage["role"],
				command: "ls -la",
				output: "total 8",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
		const text = (result[0] as any).content[0].text;
		expect(text).toContain("ls -la");
		expect(text).toContain("total 8");
	});

	it("converts fileMention to user message with file content", () => {
		const messages: AgentMessage[] = [
			{
				role: "fileMention" as AgentMessage["role"],
				files: [
					{
						path: "src/main.ts",
						content: "console.log('hello');",
					},
				],
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
		const text = (result[0] as any).content[0].text;
		expect(text).toContain('path="src/main.ts"');
		expect(text).toContain("console.log('hello');");
	});

	it("converts custom message with string content to user message", () => {
		const messages: AgentMessage[] = [
			{
				role: "custom" as AgentMessage["role"],
				customType: "test-injection",
				content: "injected context",
				display: false,
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
		const content = (result[0] as any).content;
		expect(content[0].text).toBe("injected context");
	});

	it("uses pruned content for toolResult with prunedAt set", () => {
		const messages: AgentMessage[] = [
			userMessage("go"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			{
				role: "toolResult",
				toolCallId: "tc1",
				toolName: "read",
				content: [
					{ type: "text", text: "first part" },
					{ type: "text", text: " second part" },
				],
				isError: false,
				prunedAt: 100,
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		const tr = result.find(m => m.role === "toolResult") as ToolResultMessage;
		// Pruned content should be concatenated into a single text block
		expect(tr.content).toHaveLength(1);
		expect((tr.content[0] as any).text).toBe("first part second part");
	});

	it("uses truncation fallback for pruned toolResult with no text content", () => {
		const messages: AgentMessage[] = [
			userMessage("go"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			{
				role: "toolResult",
				toolCallId: "tc1",
				toolName: "read",
				content: [],
				isError: false,
				prunedAt: 100,
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		const tr = result.find(m => m.role === "toolResult") as ToolResultMessage;
		expect(tr.content).toHaveLength(1);
		expect((tr.content[0] as any).text).toBe("[Output truncated]");
	});

	it("converts branchSummary to user message with agent attribution", () => {
		const messages: AgentMessage[] = [
			{
				role: "branchSummary" as AgentMessage["role"],
				summary: "Implemented auth flow",
				fromId: "session-abc",
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
		expect((result[0] as any).attribution).toBe("agent");
		const text = (result[0] as any).content[0].text;
		expect(text).toContain("Implemented auth flow");
	});

	it("converts compactionSummary to user message preserving providerPayload", () => {
		const payload = { type: "openaiResponsesHistory" as const, items: [{ id: "item1" }] };
		const messages: AgentMessage[] = [
			{
				role: "compactionSummary" as AgentMessage["role"],
				summary: "Condensed conversation",
				tokensBefore: 50000,
				providerPayload: payload,
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
		expect((result[0] as any).attribution).toBe("agent");
		expect((result[0] as any).providerPayload).toBe(payload);
		const text = (result[0] as any).content[0].text;
		expect(text).toContain("Condensed conversation");
	});

	it("defaults toolResult attribution to agent", () => {
		const messages: AgentMessage[] = [
			userMessage("go"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			toolResult("tc1", "read"),
		];
		const result = convertToLlm(messages);
		const tr = result.find(m => m.role === "toolResult");
		expect((tr as any).attribution).toBe("agent");
	});

	it("converts fileMention with image content blocks", () => {
		const imageBlock = {
			type: "image" as const,
			data: "base64encodeddata",
			mimeType: "image/png",
		};
		const messages: AgentMessage[] = [
			{
				role: "fileMention" as AgentMessage["role"],
				files: [
					{
						path: "screenshot.png",
						content: "",
						image: imageBlock,
					},
				],
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1);
		const content = (result[0] as any).content;
		// Should have text block + image block
		expect(content).toHaveLength(2);
		expect(content[0].type).toBe("text");
		expect(content[0].text).toContain('path="screenshot.png"');
		expect(content[1].type).toBe("image");
	});

	it("excludes pythonExecution messages with excludeFromContext", () => {
		const messages: AgentMessage[] = [
			userMessage("start"),
			{
				role: "pythonExecution" as AgentMessage["role"],
				code: "import secrets; print(secrets.token_hex())",
				output: "secret token",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				excludeFromContext: true,
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1); // Only the user message
		expect(result[0].role).toBe("user");
	});

	it("converts legacy hookMessage to user message like custom", () => {
		const messages: AgentMessage[] = [
			{
				role: "hookMessage" as AgentMessage["role"],
				customType: "legacy-hook",
				content: [{ type: "text" as const, text: "hook content" }],
				display: true,
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
		const content = (result[0] as any).content;
		expect(content[0].text).toBe("hook content");
	});

	it("defaults user message attribution to user", () => {
		const messages: AgentMessage[] = [userMessage("hello")];
		const result = convertToLlm(messages);
		expect((result[0] as any).attribution).toBe("user");
	});

	it("defaults developer message attribution to agent", () => {
		const messages: AgentMessage[] = [
			{
				role: "developer",
				content: "system guidance",
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("developer");
		expect((result[0] as any).attribution).toBe("agent");
	});

	it("passes assistant messages through unchanged", () => {
		const messages: AgentMessage[] = [
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			toolResult("tc1", "read"),
		];
		const result = convertToLlm(messages);
		const assistant = result.find(m => m.role === "assistant");
		expect(assistant).toBeDefined();
		// Assistant messages pass through as-is (no attribution added)
		expect((assistant as any).attribution).toBeUndefined();
	});

	it("does not duplicate toolResult for displaced assistant when result is later in array", () => {
		// Scenario: two consecutive assistants, tc1's result between them,
		// then a user message, then tc2's result. After first-pass repair,
		// tc2's result is separated from assistant[tc2] by the user message.
		const messages: AgentMessage[] = [
			userMessage("start"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			assistantWithToolCalls([{ id: "tc2", name: "grep" }]),
			toolResult("tc1", "read"),
			userMessage("intervening message"),
			toolResult("tc2", "grep", "real tc2 result"),
		];
		const result = convertToLlm(messages);
		// tc2 result should appear exactly once (no duplicate synthetic)
		const tc2Results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc2");
		expect(tc2Results).toHaveLength(1);
	});

	it("handles empty messages array", () => {
		const result = convertToLlm([]);
		expect(result).toHaveLength(0);
	});

	it("passes through messages with no assistant messages", () => {
		const messages: AgentMessage[] = [userMessage("hello"), userMessage("world")];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(2);
		expect(result.every(m => m.role === "user")).toBe(true);
	});

	it("preserves orphaned toolResult without matching assistant", () => {
		// A toolResult with no corresponding tool_use — should not crash
		const messages: AgentMessage[] = [
			userMessage("start"),
			toolResult("tc-orphan", "read", "orphaned result"),
			userMessage("end"),
		];
		const result = convertToLlm(messages);
		// Should pass through without error
		const tr = result.find(m => m.role === "toolResult") as ToolResultMessage;
		expect(tr).toBeDefined();
		expect(tr.toolCallId).toBe("tc-orphan");
	});

	it("converts custom message with array content", () => {
		const messages: AgentMessage[] = [
			{
				role: "custom" as AgentMessage["role"],
				customType: "rich-content",
				content: [
					{ type: "text" as const, text: "part 1" },
					{ type: "text" as const, text: "part 2" },
				],
				display: true,
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
		const content = (result[0] as any).content;
		expect(content).toHaveLength(2);
		expect(content[0].text).toBe("part 1");
		expect(content[1].text).toBe("part 2");
	});

	it("converts fileMention with empty content (path only)", () => {
		const messages: AgentMessage[] = [
			{
				role: "fileMention" as AgentMessage["role"],
				files: [{ path: "large-file.bin", content: "" }],
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1);
		const text = (result[0] as any).content[0].text;
		// Empty content produces bare newline between tags
		expect(text).toContain('path="large-file.bin"');
		expect(text).toContain('<file path="large-file.bin">\n</file>');
	});

	it("relocates multiple separated results for displaced multi-tool-call assistant", () => {
		// assistant[tc1] displaces assistant[tc2, tc3]. Both tc2 and tc3 results
		// exist later in the array separated by other messages.
		const messages: AgentMessage[] = [
			userMessage("start"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			assistantWithToolCalls([
				{ id: "tc2", name: "grep" },
				{ id: "tc3", name: "find" },
			]),
			toolResult("tc1", "read"),
			userMessage("intervening"),
			toolResult("tc2", "grep", "real tc2"),
			userMessage("more intervening"),
			toolResult("tc3", "find", "real tc3"),
		];
		const result = convertToLlm(messages);
		// Each tool call should have exactly one result
		for (const id of ["tc1", "tc2", "tc3"]) {
			const results = result.filter(m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === id);
			expect(results).toHaveLength(1);
		}
		// tc2 and tc3 should have their real (non-error) results, not synthetics
		const tc2 = result.find(
			m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc2",
		) as ToolResultMessage;
		const tc3 = result.find(
			m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc3",
		) as ToolResultMessage;
		expect(tc2.isError).toBe(false);
		expect(tc3.isError).toBe(false);
	});

	it("converts fileMention with multiple files to single user message with all paths", () => {
		const messages: AgentMessage[] = [
			{
				role: "fileMention" as AgentMessage["role"],
				files: [
					{ path: "src/main.ts", content: "import { app } from './app';" },
					{ path: "src/app.ts", content: "export const app = {};" },
					{ path: "README.md", content: "# Project" },
				],
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
		const text = (result[0] as any).content[0].text;
		// All three files should appear in the output
		expect(text).toContain('path="src/main.ts"');
		expect(text).toContain('path="src/app.ts"');
		expect(text).toContain('path="README.md"');
		// Files should be separated
		expect(text).toContain("</file>\n\n<file");
	});

	it("preserves existing user attribution on user messages", () => {
		const messages: AgentMessage[] = [
			{
				role: "user",
				content: [{ type: "text" as const, text: "hello" }],
				attribution: "agent" as const,
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		// Existing attribution should be preserved, not overwritten to "user"
		expect((result[0] as any).attribution).toBe("agent");
	});

	it("converts non-excluded pythonExecution to user message with code block", () => {
		const messages: AgentMessage[] = [
			{
				role: "pythonExecution" as AgentMessage["role"],
				code: "print(42)",
				output: "42",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: Date.now(),
			} as AgentMessage,
		];
		const result = convertToLlm(messages);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("user");
		const text = (result[0] as any).content[0].text;
		expect(text).toContain("Ran Python:");
		expect(text).toContain("```python\nprint(42)");
		expect(text).toContain("Output:\n```\n42");
	});

	it("handles complex repair: wedged messages + displaced assistant + late results", () => {
		// Realistic session corruption scenario:
		// assistant[tc1] -> custom message (wedged) -> toolResult(tc1)
		// assistant[tc2] (displaced during tc1 repair) -> user -> toolResult(tc2)
		const messages: AgentMessage[] = [
			userMessage("start"),
			assistantWithToolCalls([{ id: "tc1", name: "read" }]),
			customMessage("injected context"),
			assistantWithToolCalls([{ id: "tc2", name: "grep" }]),
			toolResult("tc1", "read", "tc1 result"),
			userMessage("user typed"),
			toolResult("tc2", "grep", "tc2 result"),
		];
		const result = convertToLlm(messages);

		// Verify structural integrity:
		// 1. No consecutive assistants without toolResults
		// 2. Each tool call has exactly one result
		// 3. No duplicate results
		const seenToolResultIds = new Set<string>();
		let prevRole = "";
		for (const msg of result) {
			if (msg.role === "assistant" && prevRole === "assistant") {
				// This should not happen after repair
				expect("consecutive assistants").toBe("never");
			}
			if (msg.role === "toolResult") {
				const id = (msg as ToolResultMessage).toolCallId;
				expect(seenToolResultIds.has(id)).toBe(false);
				seenToolResultIds.add(id);
			}
			prevRole = msg.role;
		}
		expect(seenToolResultIds.has("tc1")).toBe(true);
		expect(seenToolResultIds.has("tc2")).toBe(true);

		// tc1 should use real result (not synthetic)
		const tc1 = result.find(
			m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc1",
		) as ToolResultMessage;
		expect(tc1.isError).toBe(false);
		// tc2 should use real result (relocated by second pass)
		const tc2 = result.find(
			m => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "tc2",
		) as ToolResultMessage;
		expect(tc2.isError).toBe(false);
	});
});
