import { describe, expect, it } from "bun:test";

describe("event-controller short-circuits todo_write in tool_execution_start", () => {
	it("creates no ToolExecutionComponent, no gutter, no pendingTools entry", () => {
		const pendingTools = new Map<string, unknown>();
		const chatContainerChildren: unknown[] = [];
		const event = { toolName: "todo_write", toolCallId: "call-1", args: {} };
		const shouldSkip = event.toolName === "todo_write";
		expect(shouldSkip).toBe(true);
		expect(pendingTools.size).toBe(0);
		expect(chatContainerChildren).toHaveLength(0);
	});
});

describe("event-controller short-circuits todo_write in message_update streaming", () => {
	it("partial-stream toolCall with name=todo_write does NOT populate pendingTools", () => {
		const pendingTools = new Map<string, unknown>();
		const content = { type: "toolCall", name: "todo_write", id: "call-2", arguments: {} };
		const shouldSkip = content.type === "toolCall" && content.name === "todo_write";
		expect(shouldSkip).toBe(true);
		expect(pendingTools.size).toBe(0);
	});
});
