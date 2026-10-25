import { afterEach, describe, expect, it } from "bun:test";
import { streamAnthropic } from "../src/providers/anthropic";
import type { AssistantMessageEvent, Context, Model } from "../src/types";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});
const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-4-5",
	name: "Claude Sonnet 4.5",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 8_192,
};

const context: Context = {
	messages: [{ role: "user", content: "Say hi", timestamp: Date.now() }],
};

type MockAnthropicEvent = Record<string, unknown>;
function createTextSuccessEvents(text: string): MockAnthropicEvent[] {
	return [
		{
			type: "message_start",
			message: {
				id: "msg_text_success",
				model: "claude-served-model",
				usage: {
					input_tokens: 12,
					output_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
			},
		},
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "message_start", message: { id: "msg_duplicate", usage: { input_tokens: 99, output_tokens: 99 } } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: {
				input_tokens: 12,
				output_tokens: 4,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
		{ type: "message_stop" },
	];
}

function createMalformedPreMessageStartEvents(): MockAnthropicEvent[] {
	return [{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }];
}

describe("Anthropic retry allowance", () => {
	it("zero allowance prevents Anthropic stream retry", async () => {
		let attempt = 0;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			attempt++;
			const events = attempt === 1 ? createMalformedPreMessageStartEvents() : createTextSuccessEvents("recovered");
			return new Response(
				events.map(event => "event: " + event.type + "\ndata: " + JSON.stringify(event) + "\n\n").join(""),
				{ status: 200, headers: { "content-type": "text/event-stream" } },
			);
		}) as unknown as typeof fetch;

		const stream = streamAnthropic(model, context, { apiKey: "sk-ant-test", maxRetries: 0 });
		const events: AssistantMessageEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}
		const result = await stream.result();

		globalThis.fetch = originalFetch;
		expect(attempt).toBe(1);
		expect(result.stopReason).toBe("error");
	});
});
