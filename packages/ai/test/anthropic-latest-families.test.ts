import { describe, expect, it } from "bun:test";
import { CURRENT_ANTHROPIC_MODELS } from "../src/current-anthropic-models";
import { enrichModelThinking, getSupportedReasoningEfforts } from "../src/model-thinking";
import { mapOptionsForApi } from "../src/stream";
import type { Model } from "../src/types";

describe("verified Claude 5.5 families", () => {
	it.each(["sonnet", "opus"])(
		"requires native thinking while allowing the verified gateway override for %s",
		family => {
			const record = CURRENT_ANTHROPIC_MODELS.find(model => model.id === `claude-${family}-5-5`)!;
			const native = enrichModelThinking(record);
			expect(() => mapOptionsForApi(native, { reasoning: "none" as any })).toThrow("not supported");
			const gateway = enrichModelThinking({
				...record,
				baseUrl: "https://proxy.example.com/anthropic",
				compat: { ...record.compat, requiresThinkingEnabled: false },
			});
			expect(mapOptionsForApi(gateway, { reasoning: "none" as any })).toMatchObject({ thinkingEnabled: false });
		},
	);
	it.each(["haiku", "sonnet", "opus"])("exposes only the five measured wire efforts for %s 5.5", family => {
		const model = enrichModelThinking({
			id: `claude-${family}-5-5`,
			name: family,
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 8192,
		} as Model<"anthropic-messages">);
		expect(model.thinking?.mode).toBe("anthropic-adaptive");
		expect(getSupportedReasoningEfforts(model).filter(e => e !== "none")).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
	});
});
