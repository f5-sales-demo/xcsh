import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getBundledModel } from "../src/models";
import { streamOpenAICompletions } from "../src/providers/openai-completions";
import type { Model } from "../src/types";

describe("Chat Completions reported usage", () => {
	it("counts reasoning once and preserves reported cache writes", async () => {
		const model: Model<"openai-completions"> = {
			...getBundledModel("openai", "gpt-4o-mini"),
			api: "openai-completions",
		};
		using _hook = hookFetch(async () => {
			const events = [
				{
					choices: [{ index: 0, delta: { content: "synthetic" }, finish_reason: "stop" }],
					usage: {
						prompt_tokens: 100,
						completion_tokens: 20,
						total_tokens: 120,
						prompt_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 },
						completion_tokens_details: { reasoning_tokens: 5 },
					},
				},
			];
			return new Response(`${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`, {
				headers: { "Content-Type": "text/event-stream" },
			});
		});
		const result = await streamOpenAICompletions(model, { messages: [] }, { apiKey: "synthetic" }).result();
		expect(result.stopReason).toBe("stop");
		expect(result.usage).toMatchObject({
			input: 60,
			output: 20,
			cacheRead: 30,
			cacheWrite: 10,
			totalTokens: 120,
			reasoningTokens: 5,
			cacheWriteTokens: 10,
		});
	});
});
