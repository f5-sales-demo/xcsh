import { expect, test } from "bun:test";
import { type AgentTool, AgentToolError } from "@f5-sales-demo/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { wrapToolWithMetaNotice } from "../../src/tools/output-meta";
import { ToolError } from "../../src/tools/tool-errors";

class RenderedFailure extends ToolError {
	override render() {
		return "Rendered failure";
	}
}

test.each([false, true])("output wrapper retains execution facts and error rendering: custom=%s", async custom => {
	const details = { execution: { kind: "command", exitCode: 7 } };
	const original = custom
		? new RenderedFailure("Original failure", undefined, details)
		: new ToolError("Original failure", undefined, details);
	const tool: AgentTool = {
		name: "fixture",
		label: "Fixture",
		description: "Fixture",
		parameters: Type.Object({}),
		execute: async () => {
			throw original;
		},
	};
	const error = await wrapToolWithMetaNotice(tool)
		.execute("fixture", {})
		.catch(error => error);
	expect(error).toBeInstanceOf(AgentToolError);
	expect(error.result.details).toEqual(details);
	expect(error.result.content).toEqual([{ type: "text", text: custom ? "Rendered failure" : "Original failure" }]);
});
