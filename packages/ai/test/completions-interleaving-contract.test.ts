import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getBundledModel } from "../src/models";
import { streamOpenAICompletions } from "../src/providers/openai-completions";
import type { Model } from "../src/types";

describe("completion tool index correlation", () => {
	it("keeps interleaved argument deltas with their indexed calls", async () => {
		const events = [
			{
				choices: [
					{
						index: 0,
						delta: {
							tool_calls: [
								{ index: 0, id: "call_a", function: { name: "read", arguments: '{"a":' } },
								{ index: 1, id: "call_b", function: { name: "write", arguments: '{"b":' } },
							],
						},
					},
				],
			},
			{ choices: [{ index: 0, delta: { content: "synthetic" } }] },
			{
				choices: [
					{
						index: 0,
						delta: {
							tool_calls: [
								{ index: 1, function: { arguments: "2}" } },
								{ index: 0, function: { arguments: "1}" } },
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
		];
		using _hook = hookFetch(
			async () =>
				new Response(`${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`, {
					headers: { "Content-Type": "text/event-stream" },
				}),
		);
		const result = await streamOpenAICompletions(
			{ ...getBundledModel("openai", "gpt-4o-mini"), api: "openai-completions" } as Model<"openai-completions">,
			{ messages: [] },
			{ apiKey: "synthetic" },
		).result();
		expect(result.stopReason).toBe("toolUse");
		expect(result.content.filter(block => block.type === "toolCall")).toMatchObject([
			{ id: "call_a", arguments: { a: 1 } },
			{ id: "call_b", arguments: { b: 2 } },
		]);
	});
});
