import { expect, test } from "bun:test";
import { type AgentTool, AgentToolError } from "@f5-sales-demo/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { ExtensionToolWrapper } from "../src/extensibility/extensions/wrapper";
import { ToolAbortError, ToolError } from "../src/tools/tool-errors";

const details = { execution: { kind: "command", exitCode: 7, durationMs: 23 } };
const content = [{ type: "text" as const, text: "Fixture output" }];

test("tool errors retain explicitly supplied execution details without exposing contextual diagnostics", () => {
	const error = new ToolError("Fixture failure", { diagnostic: "private fixture context" }, details);
	expect(error).toBeInstanceOf(AgentToolError);
	expect(error.result).toEqual({ content: [{ type: "text", text: "Fixture failure" }], details });
	expect(JSON.stringify(error.result)).not.toContain("private fixture context");
	expect(error.render()).toBe("Fixture failure");
});

test("aborted tool results retain supplied details and their existing error class", () => {
	const error = new ToolAbortError("Fixture cancelled", details);
	expect(error).toBeInstanceOf(AgentToolError);
	expect(error.result).toEqual({ content: [{ type: "text", text: "Fixture cancelled" }], details });
	expect(error.name).toBe("ToolAbortError");
});

test.each([
	{ change: {}, failed: true, expectedContent: content, expectedDetails: details },
	{
		change: { content: [{ type: "text", text: "Revised failure" }] },
		failed: true,
		expectedContent: [{ type: "text", text: "Revised failure" }],
		expectedDetails: details,
	},
	{
		change: { details: { reviewed: true } },
		failed: true,
		expectedContent: content,
		expectedDetails: { reviewed: true },
	},
	{ change: { isError: false }, failed: false, expectedContent: content, expectedDetails: details },
])(
	"extension result changes retain structured execution data: $change",
	async ({ change, failed, expectedContent, expectedDetails }) => {
		let observed: any;
		const tool: AgentTool = {
			name: "fixture",
			label: "Fixture",
			description: "Fixture",
			parameters: Type.Object({}),
			executionKind: "command",
			execute: async () => {
				throw new AgentToolError("Fixture error", { content, details });
			},
		};
		const wrapper = new ExtensionToolWrapper(tool, {
			hasHandlers: (name: string) => name === "tool_result",
			emitToolResult: async (event: any) => {
				observed = event;
				return change;
			},
		} as any);
		expect(wrapper.executionKind).toBe("command");
		const result = await wrapper.execute("call-1", {}).then(
			value => ({ failed: false, value }),
			error => ({ failed: true, value: error.result }),
		);
		expect(observed).toMatchObject({ content, details, isError: true });
		expect(result).toEqual({ failed, value: { content: expectedContent, details: expectedDetails } });
	},
);

test("an extension marking success as failure preserves its complete modified result", async () => {
	const tool: AgentTool = {
		name: "fixture",
		label: "Fixture",
		description: "Fixture",
		parameters: Type.Object({}),
		execute: async () => ({ content, details }),
	};
	const wrapper = new ExtensionToolWrapper(tool, {
		hasHandlers: (name: string) => name === "tool_result",
		emitToolResult: async () => ({ isError: true }),
	} as any);
	const error = await wrapper.execute("call-1", {}).catch(error => error);
	expect(error).toBeInstanceOf(AgentToolError);
	expect(error.result).toEqual({ content, details });
});
