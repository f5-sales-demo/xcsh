import { describe, expect, it } from "bun:test";
import { processResponsesStream } from "../src/providers/openai-responses-shared";
import type { AssistantMessage, Model } from "../src/types";

const model: Model<"openai-responses"> = {
	id: "requested-model",
	name: "Requested",
	api: "openai-responses",
	provider: "litellm",
	baseUrl: "https://gateway.example/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 4_096,
};

function message(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "litellm",
		model: model.id,
		responseAttribution: { requestedModel: model.id },
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("server response attribution", () => {
	it("captures the OpenAI-compatible response model without changing the request model", async () => {
		const output = message();
		const events = [
			{ type: "response.created", response: { id: "response-1", model: "served-model" } },
			{
				type: "response.completed",
				response: {
					id: "response-1",
					model: "served-model",
					status: "completed",
					usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
				},
			},
		];
		await processResponsesStream(
			{
				async *[Symbol.asyncIterator]() {
					yield* events as any;
				},
			} as any,
			output,
			{ push() {} } as any,
			model,
		);
		expect(output.model).toBe("requested-model");
		expect(output.responseAttribution).toEqual({
			requestedModel: "requested-model",
			responseModel: "served-model",
			responseModelSource: "response-body",
		});
	});
});
