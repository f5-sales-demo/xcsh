import { describe, expect, it } from "bun:test";
import { Type } from "@sinclair/typebox";
import { getBundledModel } from "../src/models";
import { streamOpenAICompletions } from "../src/providers/openai-completions";
import type { Model } from "../src/types";

describe("OpenRouter Anthropic completion cache retention", () => {
	it("honors disabled caching and adds system/tool/conversation breakpoints when enabled", async () => {
		const model = {
			...getBundledModel("openai", "gpt-4o-mini"),
			id: "anthropic/synthetic",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			api: "openai-completions",
		} as Model<"openai-completions">;
		for (const retention of ["none", "short", "long"] as const) {
			let body: any;
			await streamOpenAICompletions(
				model,
				{
					systemPrompt: "synthetic system",
					messages: [{ role: "user", content: "synthetic", timestamp: 0 }],
					tools: [{ name: "read", description: "Read", parameters: Type.Object({}) }],
				},
				{
					apiKey: "synthetic",
					cacheRetention: retention,
					signal: AbortSignal.abort(),
					onPayload: value => {
						body = value;
					},
				},
			).result();
			if (retention === "none") expect(JSON.stringify(body)).not.toContain("cache_control");
			else {
				expect(body.messages[0].content[0]).toHaveProperty("cache_control.type", "ephemeral");
				expect(body.messages.at(-1).content[0]).toHaveProperty("cache_control.type", "ephemeral");
				expect(body.tools.at(-1)).toHaveProperty("cache_control.type", "ephemeral");
			}
		}
	});
});
