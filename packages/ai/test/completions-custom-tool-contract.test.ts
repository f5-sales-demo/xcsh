import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { getBundledModel } from "../src/models";
import { convertMessages, streamOpenAICompletions } from "../src/providers/openai-completions";
import { resolveOpenAICompat } from "../src/providers/openai-completions-compat";
import type { Model } from "../src/types";

describe("Chat Completions custom tools", () => {
	it("preserves custom input through streaming and replay", async () => {
		const model = {
			...getBundledModel("openai", "gpt-4o-mini"),
			api: "openai-completions",
			compat: { supportsOpenAIGrammarTools: true },
		} as Model<"openai-completions">;
		let body: any;
		using _hook = hookFetch(async (_url, init) => {
			body = JSON.parse(String(init?.body));
			return new Response(
				'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_synthetic","type":"custom","custom":{"name":"patch","input":"synthetic patch"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
				{ headers: { "Content-Type": "text/event-stream" } },
			);
		});
		const context = {
			messages: [],
			tools: [
				{
					name: "patch",
					description: "Patch",
					parameters: Type.Object({ source: Type.String() }),
					constrainedSampling: { type: "grammar" as const, variants: { openai_lark: "start: /.+/" } },
				},
			],
		};
		const result = await streamOpenAICompletions(model, context, { apiKey: "synthetic" }).result();
		expect(result.stopReason).toBe("toolUse");
		expect(body.tools[0]).toMatchObject({
			type: "custom",
			custom: { name: "patch", format: { type: "grammar", grammar: { syntax: "lark" } } },
		});
		expect(result.content).toMatchObject([
			{ type: "toolCall", name: "patch", arguments: { source: "synthetic patch" }, customInputProperty: "source" },
		]);
		expect(convertMessages(model, { messages: [result] }, resolveOpenAICompat(model))[0]).toMatchObject({
			tool_calls: [{ type: "custom", custom: { name: "patch", input: "synthetic patch" } }],
		});
	});
});
