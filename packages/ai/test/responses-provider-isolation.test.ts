import { describe, expect, it } from "bun:test";
import { getBundledModel } from "../src/models";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import type { AssistantMessage, Model, ToolResultMessage } from "../src/types";

describe("Responses provider isolation", () => {
	it("downgrades foreign custom calls and results together and strips encrypted reasoning", async () => {
		const source: AssistantMessage = {
			role: "assistant",
			provider: "meta",
			api: "openai-responses",
			model: "synthetic-meta",
			content: [
				{
					type: "thinking",
					thinking: "",
					thinkingSignature: JSON.stringify({
						id: "rs_synthetic",
						type: "reasoning",
						encrypted_content: "synthetic-foreign",
					}),
				},
				{
					type: "toolCall",
					id: "call_synthetic|ct_synthetic",
					name: "patch",
					arguments: { input: "synthetic patch" },
					customInputProperty: "input",
					namespace: "demo-app",
				},
			],
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 0,
		};
		const result: ToolResultMessage = {
			role: "toolResult",
			customTool: true,
			toolCallId: "call_synthetic|ct_synthetic",
			toolName: "patch",
			content: [{ type: "text", text: "done" }],
			isError: false,
			timestamp: 1,
		};
		let body: any;
		await streamOpenAIResponses(
			getBundledModel("openai", "gpt-6.1-sol") as Model<"openai-responses">,
			{ messages: [source, result] },
			{
				apiKey: "synthetic",
				signal: AbortSignal.abort(),
				onPayload: value => {
					body = value;
				},
			},
		).result();
		expect(body.input.map((item: any) => item.type)).toEqual(["function_call", "function_call_output"]);
		expect(body.input[0]).not.toHaveProperty("namespace");
		expect(body.input[1].call_id).toBe(body.input[0].call_id);
		expect(JSON.stringify(body)).not.toContain("synthetic-foreign");
	});
});
