import { describe, expect, it } from "bun:test";
import type { ContextProfile } from "../../src/context/profile";
import { formatContextProfile } from "../../src/debug";

describe("Context Profile debug view", () => {
	it("shows prompt, tool, provider/cache, and window measurements", () => {
		const profile: ContextProfile = {
			loadingMode: "progressive",
			systemPromptBytes: 12000,
			estimatedSystemPromptTokens: 3000,
			initialToolBytes: 16000,
			deferredToolBytes: 32000,
			components: [],
			tools: [],
			providerCalls: [
				{
					call: 1,
					provider: "google",
					model: "gemini-test",
					api: "google-generative-ai",
					payloadBytes: 28000,
					estimatedPayloadTokens: 7000,
					categoryBytes: { system_prompt: 12000, tools: 14000, messages: 1000, tool_results: 0, other: 1000 },
					toolCount: 9,
					messageCount: 1,
					tools: [],
					messages: [],
					contextWindow: 1_000_000,
					providerInputTokens: 4000,
					providerCacheReadTokens: 20000,
					providerCacheWriteTokens: 0,
					providerPromptTokens: 24000,
					providerOutputTokens: 2,
					windowPercentage: 2.4,
				},
			],
		};

		const rendered = formatContextProfile(profile);
		expect(rendered).toContain("Context Profile");
		expect(rendered).toContain("progressive");
		expect(rendered).toContain("cache read 20,000");
		expect(rendered).toContain("2.400%");
		expect(rendered).not.toContain("undefined");
	});
});
