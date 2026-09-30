import { describe, expect, it } from "bun:test";
import { Type } from "@sinclair/typebox";
import { getBundledModel } from "../src/models";
import { streamAnthropic } from "../src/providers/anthropic";
import type { Context, Model } from "../src/types";

const read = { name: "read", description: "Read", parameters: Type.Object({ path: Type.String() }) };
const write = { name: "write", description: "Write", parameters: Type.Object({ path: Type.String() }) };
const context: Context = {
	systemPrompt: "Initial",
	tools: [read],
	messages: [
		{ role: "user", content: "synthetic", timestamp: 0 },
		{
			role: "developer",
			content: "Updated instructions",
			toolsAdded: [write],
			toolsRemoved: [{ name: "read" }],
			timestamp: 1,
		},
	],
};
async function payload(compat: any) {
	let body: any;
	await streamAnthropic(
		{ ...getBundledModel("anthropic", "claude-opus-5-5"), compat } as Model<"anthropic-messages">,
		context,
		{
			apiKey: "synthetic",
			signal: AbortSignal.abort(),
			onPayload: value => {
				body = value;
			},
		},
	).result();
	return body;
}
describe("Anthropic transcript controls", () => {
	it("anchors system and tool changes while retaining deferred declarations", async () => {
		const body = await payload({ supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true });
		expect(body.messages.at(-1)).toMatchObject({
			role: "system",
			content: [
				{ type: "text", text: "Updated instructions" },
				{ type: "tool_removal", tool: { name: "read" } },
				{ type: "tool_addition", tool: { name: "write" } },
			],
		});
		expect(body.tools.find((tool: any) => tool.name === "write")).toHaveProperty("defer_loading", true);
		expect(body.tools.some((tool: any) => tool.name === "read")).toBe(true);
	});
	it("retains equivalent current instructions and tools on unsupported routes", async () => {
		const body = await payload({});
		expect(body.tools.map((tool: any) => tool.name)).toEqual(["write"]);
		expect(JSON.stringify(body.system)).toContain("Updated instructions");
	});
});
