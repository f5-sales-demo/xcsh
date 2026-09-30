import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getBundledModel } from "../src/models";
import { convertMessages, detectCompat, streamOpenAICompletions } from "../src/providers/openai-completions";
import { transformMessages } from "../src/providers/transform-messages";
import type { AssistantMessage, Model, ToolCall } from "../src/types";

const model: Model<"openai-completions"> = {
	...getBundledModel("openai", "gpt-4o-mini"),
	id: "synthetic",
	provider: "openrouter",
	baseUrl: "https://openrouter.ai/api/v1",
	api: "openai-completions",
	reasoning: true,
};
const detail = { type: "reasoning.encrypted", id: "reasoning_synthetic", data: "synthetic-encrypted" };
describe("completion encrypted replay", () => {
	it("retains detached encrypted and signed reasoning details in order", async () => {
		const details = [
			{ type: "reasoning.text", text: "synthetic reasoning", signature: "synthetic-signature" },
			detail,
			{ type: "reasoning.summary", summary: "synthetic summary" },
		];
		using _hook = hookFetch(
			async () =>
				new Response(
					`data: ${JSON.stringify({ id: "synthetic", choices: [{ index: 0, delta: { reasoning_details: details }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "done" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
					{ headers: { "Content-Type": "text/event-stream" } },
				),
		);
		const result = await streamOpenAICompletions(model, { messages: [] }, { apiKey: "synthetic" }).result();
		expect(result.stopReason).toBe("stop");
		const thinking = result.content.find(part => part.type === "thinking");
		expect(thinking?.thinkingSignature).toBe(JSON.stringify(details));
		const replay = convertMessages(model, { messages: [result] }, detectCompat(model));
		expect(replay.find(message => message.role === "assistant")).toMatchObject({ reasoning_details: details });
		expect(replay[0]).not.toHaveProperty(JSON.stringify(details));
		const foreign = convertMessages({ ...model, provider: "other" }, { messages: [result] }, detectCompat(model));
		expect(foreign[0]).not.toHaveProperty("reasoning_details");
	});
	it("keeps foreign custom-tool downgrade when stripping its reasoning signature", () => {
		const call: ToolCall = {
			type: "toolCall",
			id: "call_synthetic",
			name: "read",
			arguments: {},
			customInputProperty: "input",
			namespace: "demo-app",
			thoughtSignature: JSON.stringify(detail),
		};
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [call],
			api: model.api,
			provider: model.provider,
			model: model.id,
			stopReason: "toolUse",
			timestamp: 0,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		};
		const result = transformMessages(
			[
				assistant,
				{
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					customTool: true,
					content: [{ type: "text", text: "synthetic" }],
					isError: false,
					timestamp: 0,
				},
			],
			{ ...model, provider: "other" },
		);
		expect((result[0] as AssistantMessage).content[0]).toMatchObject({
			customInputProperty: undefined,
			namespace: undefined,
		});
		expect((result[0] as AssistantMessage).content[0]).not.toHaveProperty("thoughtSignature");
		expect(result[1]).toMatchObject({ customTool: undefined });
	});
});
