import { describe, expect, it } from "bun:test";
import { Type } from "@sinclair/typebox";
import { getBundledModel } from "../src/models";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import type { Context, Model, OpenAIResponsesCompat } from "../src/types";

const tool = (name: string) => ({ name, description: name, parameters: Type.Object({ input: Type.String() }) });
async function payload(compat: OpenAIResponsesCompat, context: Context) {
	let body: any;
	await streamOpenAIResponses(
		{ ...getBundledModel("openai", "gpt-6.1-sol"), compat } as Model<"openai-responses">,
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
describe("transcript-anchored Responses controls", () => {
	it("retains developer role and additional tool anchors", async () => {
		const body = await payload(
			{ supportsAdditionalTools: true },
			{
				tools: [tool("read")],
				messages: [
					{ role: "user", content: "start", timestamp: 0 },
					{ role: "developer", content: "New instructions", toolsAdded: [tool("write")], timestamp: 1 },
				],
			},
		);
		expect(body.input[1].role).toBe("developer");
		expect(body.input[2]).toMatchObject({ type: "additional_tools", role: "developer", tools: [{ name: "write" }] });
		expect(body.tools.map((item: any) => item.name)).toEqual(["read"]);
	});
	it("exposes equivalent tools on routes without transcript additions", async () => {
		const body = await payload(
			{},
			{
				tools: [tool("read")],
				messages: [{ role: "developer", content: "update", toolsAdded: [tool("write")], timestamp: 1 }],
			},
		);
		expect(body.tools.map((item: any) => item.name)).toEqual(["read", "write"]);
	});
	it("encodes client tool-search correlation when additional_tools is unavailable", async () => {
		const body = await payload(
			{ supportsToolSearch: true },
			{ messages: [{ role: "developer", content: "update", toolsAdded: [tool("read")], timestamp: 1 }] },
		);
		expect(body.input[1]).toMatchObject({ type: "tool_search_call", execution: "client", status: "completed" });
		expect(body.input[2]).toMatchObject({
			type: "tool_search_output",
			execution: "client",
			call_id: body.input[1].call_id,
			tools: [{ name: "read" }],
		});
	});
});
