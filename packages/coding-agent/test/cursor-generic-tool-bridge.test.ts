import { describe, expect, it } from "bun:test";
import type { AgentEvent, AgentTool } from "@f5-sales-demo/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { CursorExecHandlers } from "../src/cursor";

describe("Cursor generic tool bridge", () => {
	it("executes a registered generic tool without MCP-specific naming", async () => {
		const calls: Array<{ id: string; args: unknown }> = [];
		const events: AgentEvent[] = [];
		const tool: AgentTool = {
			name: "lookup_widget",
			label: "Lookup widget",
			description: "Looks up one widget",
			parameters: Type.Object({ id: Type.String() }),
			async execute(id, args) {
				calls.push({ id, args });
				const widgetId = (args as { id: string }).id;
				return { content: [{ type: "text", text: `widget:${widgetId}` }] };
			},
		};
		const handlers = new CursorExecHandlers({
			cwd: process.cwd(),
			tools: new Map([[tool.name, tool]]),
			emitEvent: event => events.push(event),
		});

		const result = await handlers.tool({
			name: "lookup_widget",
			providerIdentifier: "xcsh",
			toolName: "lookup_widget",
			toolCallId: "call-1",
			args: { id: "42" },
			rawArgs: {},
		});

		expect(calls).toEqual([{ id: "call-1", args: { id: "42" } }]);
		expect(result).toMatchObject({
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "lookup_widget",
			content: [{ type: "text", text: "widget:42" }],
			isError: false,
		});
		expect(events.map(event => event.type)).toEqual(["tool_execution_start", "tool_execution_end"]);
	});
});
