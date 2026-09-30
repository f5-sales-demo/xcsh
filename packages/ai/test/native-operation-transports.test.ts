import { describe, expect, it } from "bun:test";
import { stream } from "../src/stream";
import type { Model } from "../src/types";

const model = (api: string): Model => ({
	id: "synthetic",
	name: "Synthetic",
	api,
	provider: api === "pi-messages" ? "radius" : "mistral",
	baseUrl: "https://provider.example.com",
	reasoning: false,
	input: ["text"],
	contextWindow: 32000,
	maxTokens: 1000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});
const usage = {
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
describe("native operation transports", () => {
	it("dispatches pi messages and retains streamed text, usage and reasoning signatures", async () => {
		const events = [
			{ type: "start" },
			{ type: "thinking_start", contentIndex: 0 },
			{ type: "thinking_end", contentIndex: 0, content: "", contentSignature: "synthetic-encrypted" },
			{ type: "text_start", contentIndex: 1 },
			{ type: "text_delta", contentIndex: 1, delta: "ready" },
			{ type: "text_end", contentIndex: 1, content: "ready" },
			{ type: "done", reason: "stop", usage },
		];
		const result = await stream(
			model("pi-messages"),
			{ messages: [] },
			{
				apiKey: "synthetic",
				fetch: async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")),
			},
		).result();
		expect(result.stopReason).toBe("stop");
		expect(result.content).toMatchObject([
			{ type: "thinking", thinkingSignature: "synthetic-encrypted" },
			{ type: "text", text: "ready" },
		]);
	});
	it("dispatches Mistral native streaming with cache accounting", async () => {
		let payload: any;
		const result = await stream(
			model("mistral-conversations"),
			{ messages: [{ role: "user", content: "synthetic", timestamp: 0 }] },
			{
				apiKey: "synthetic",
				fetch: async (_url, init) => {
					payload = JSON.parse(String(init?.body));
					return new Response(
						`data: ${JSON.stringify({ id: "synthetic", choices: [{ index: 0, delta: { content: "ready" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11, prompt_tokens_details: { cached_tokens: 5 } } })}\n\ndata: [DONE]\n\n`,
					);
				},
			},
		).result();
		expect(payload.messages[0].content).toBe("synthetic");
		expect(result.stopReason).toBe("stop");
		expect(result.usage).toMatchObject({ input: 5, cacheRead: 5, output: 1 });
	});
});
