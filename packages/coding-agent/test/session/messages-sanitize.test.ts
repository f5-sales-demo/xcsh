import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@f5xc-salesdemos/pi-ai";
import {
	type BashExecutionMessage,
	bashExecutionToText,
	type PythonExecutionMessage,
	pythonExecutionToText,
	sanitizeRehydratedOpenAIResponsesAssistantMessage,
} from "../../src/session/messages";

function mockOpenAIResponsesAssistant(
	content: AssistantMessage["content"],
	opts?: { thinkingSignature?: string },
): AssistantMessage {
	const blocks: AssistantMessage["content"] = [];
	if (opts?.thinkingSignature) {
		blocks.push({
			type: "thinking",
			thinking: "internal reasoning",
			thinkingSignature: opts.thinkingSignature,
		});
	}
	blocks.push(...content);
	return {
		role: "assistant",
		content: blocks,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o",
		providerPayload: { type: "openaiResponsesHistory", items: [] },
		usage: {
			input: 100,
			output: 50,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 150,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("sanitizeRehydratedOpenAIResponsesAssistantMessage", () => {
	it("passes through non-OpenAI-Responses messages unchanged", () => {
		const msg: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-3-5-sonnet",
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
		const result = sanitizeRehydratedOpenAIResponsesAssistantMessage(msg);
		expect(result).toBe(msg); // Same reference — no transformation
	});

	it("strips providerPayload from OpenAI Responses rehydrated messages", () => {
		const msg = mockOpenAIResponsesAssistant([{ type: "text", text: "answer" }]);
		expect(msg.providerPayload).toBeDefined();

		const result = sanitizeRehydratedOpenAIResponsesAssistantMessage(msg);
		expect(result.providerPayload).toBeUndefined();
		// Content preserved
		const textBlock = result.content.find(b => b.type === "text");
		expect(textBlock).toBeDefined();
	});

	it("strips thinking signatures from rehydrated messages", () => {
		const msg = mockOpenAIResponsesAssistant([{ type: "text", text: "answer" }], {
			thinkingSignature: "base64-signature-data",
		});

		const result = sanitizeRehydratedOpenAIResponsesAssistantMessage(msg);
		const thinkingBlock = result.content.find(b => b.type === "thinking");
		expect(thinkingBlock).toBeDefined();
		expect((thinkingBlock as any).thinkingSignature).toBeUndefined();
		expect((thinkingBlock as any).thinking).toBe("internal reasoning");
	});

	it("preserves content reference when no thinking signatures exist", () => {
		const msg = mockOpenAIResponsesAssistant([{ type: "text", text: "answer" }]);

		const result = sanitizeRehydratedOpenAIResponsesAssistantMessage(msg);
		expect(result.providerPayload).toBeUndefined();
		// Content should be the same reference since no sanitization was needed
		expect(result.content).toBe(msg.content);
	});

	it("selectively strips signatures from thinking blocks with mixed signed/unsigned", () => {
		const msg = mockOpenAIResponsesAssistant([{ type: "text", text: "answer" }], {
			thinkingSignature: "signed-block",
		});
		// Add a second thinking block WITHOUT a signature
		msg.content.splice(1, 0, {
			type: "thinking",
			thinking: "unsigned reasoning",
		} as any);

		const result = sanitizeRehydratedOpenAIResponsesAssistantMessage(msg);
		const thinkingBlocks = result.content.filter(b => b.type === "thinking");
		expect(thinkingBlocks).toHaveLength(2);
		// First thinking (signed) should have signature stripped
		expect((thinkingBlocks[0] as any).thinkingSignature).toBeUndefined();
		expect((thinkingBlocks[0] as any).thinking).toBe("internal reasoning");
		// Second thinking (unsigned) should pass through unchanged
		expect((thinkingBlocks[1] as any).thinkingSignature).toBeUndefined();
		expect((thinkingBlocks[1] as any).thinking).toBe("unsigned reasoning");
		// Provider payload should still be stripped
		expect(result.providerPayload).toBeUndefined();
	});
});

describe("bashExecutionToText", () => {
	it("formats command with output", () => {
		const msg: BashExecutionMessage = {
			role: "bashExecution",
			command: "ls -la",
			output: "total 8\ndrwxr-xr-x  2 user user 4096 Jan 1 00:00 .",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: Date.now(),
		};
		const text = bashExecutionToText(msg);
		expect(text).toContain("Ran `ls -la`");
		expect(text).toContain("```\ntotal 8");
		expect(text).not.toContain("cancelled");
		expect(text).not.toContain("exited with code");
	});

	it("formats command with no output", () => {
		const msg: BashExecutionMessage = {
			role: "bashExecution",
			command: "touch file.txt",
			output: "",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: Date.now(),
		};
		const text = bashExecutionToText(msg);
		expect(text).toContain("(no output)");
	});

	it("includes cancelled notice", () => {
		const msg: BashExecutionMessage = {
			role: "bashExecution",
			command: "sleep 100",
			output: "",
			exitCode: undefined,
			cancelled: true,
			truncated: false,
			timestamp: Date.now(),
		};
		const text = bashExecutionToText(msg);
		expect(text).toContain("(command cancelled)");
	});

	it("includes non-zero exit code", () => {
		const msg: BashExecutionMessage = {
			role: "bashExecution",
			command: "false",
			output: "error message",
			exitCode: 1,
			cancelled: false,
			truncated: false,
			timestamp: Date.now(),
		};
		const text = bashExecutionToText(msg);
		expect(text).toContain("Command exited with code 1");
		expect(text).not.toContain("cancelled");
	});
});

describe("pythonExecutionToText", () => {
	it("formats code with output", () => {
		const msg: PythonExecutionMessage = {
			role: "pythonExecution",
			code: "print('hello')",
			output: "hello",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: Date.now(),
		};
		const text = pythonExecutionToText(msg);
		expect(text).toContain("Ran Python:");
		expect(text).toContain("```python\nprint('hello')");
		expect(text).toContain("Output:\n```\nhello");
	});

	it("includes non-zero exit code for failed execution", () => {
		const msg: PythonExecutionMessage = {
			role: "pythonExecution",
			code: "raise ValueError()",
			output: "ValueError",
			exitCode: 1,
			cancelled: false,
			truncated: false,
			timestamp: Date.now(),
		};
		const text = pythonExecutionToText(msg);
		expect(text).toContain("Execution failed with code 1");
	});

	it("includes cancelled notice", () => {
		const msg: PythonExecutionMessage = {
			role: "pythonExecution",
			code: "import time; time.sleep(100)",
			output: "",
			exitCode: undefined,
			cancelled: true,
			truncated: false,
			timestamp: Date.now(),
		};
		const text = pythonExecutionToText(msg);
		expect(text).toContain("(execution cancelled)");
	});

	it("formats code with no output", () => {
		const msg: PythonExecutionMessage = {
			role: "pythonExecution",
			code: "x = 42",
			output: "",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: Date.now(),
		};
		const text = pythonExecutionToText(msg);
		expect(text).toContain("(no output)");
	});
});

// Import factory functions
import {
	createBranchSummaryMessage,
	createCompactionSummaryMessage,
	createCustomMessage,
} from "../../src/session/messages";

describe("createBranchSummaryMessage", () => {
	it("constructs a BranchSummaryMessage with parsed timestamp", () => {
		const msg = createBranchSummaryMessage("Added auth flow", "session-abc", "2026-01-15T10:30:00Z");
		expect(msg.role).toBe("branchSummary");
		expect(msg.summary).toBe("Added auth flow");
		expect(msg.fromId).toBe("session-abc");
		expect(msg.timestamp).toBe(new Date("2026-01-15T10:30:00Z").getTime());
	});
});

describe("createCompactionSummaryMessage", () => {
	it("constructs message with required fields", () => {
		const msg = createCompactionSummaryMessage("Condensed context", 50000, "2026-01-15T10:30:00Z");
		expect(msg.role).toBe("compactionSummary");
		expect(msg.summary).toBe("Condensed context");
		expect(msg.tokensBefore).toBe(50000);
		expect(msg.shortSummary).toBeUndefined();
		expect(msg.providerPayload).toBeUndefined();
	});

	it("includes optional shortSummary and providerPayload", () => {
		const payload = { type: "openaiResponsesHistory" as const, items: [] };
		const msg = createCompactionSummaryMessage(
			"Full summary",
			75000,
			"2026-01-15T10:30:00Z",
			"Short version",
			payload,
		);
		expect(msg.shortSummary).toBe("Short version");
		expect(msg.providerPayload).toBe(payload);
	});
});

describe("createCustomMessage", () => {
	it("constructs a CustomMessage with string content", () => {
		const msg = createCustomMessage("test-type", "hello", true, { key: "val" }, "2026-01-15T10:30:00Z");
		expect(msg.role).toBe("custom");
		expect(msg.customType).toBe("test-type");
		expect(msg.content).toBe("hello");
		expect(msg.display).toBe(true);
		expect(msg.details).toEqual({ key: "val" });
		expect(msg.timestamp).toBe(new Date("2026-01-15T10:30:00Z").getTime());
		expect(msg.attribution).toBeUndefined();
	});

	it("includes attribution when provided", () => {
		const msg = createCustomMessage("ext", "data", false, undefined, "2026-01-15T10:30:00Z", "agent");
		expect(msg.attribution).toBe("agent");
	});
});
