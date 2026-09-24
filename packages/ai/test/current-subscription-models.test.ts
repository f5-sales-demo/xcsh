import { describe, expect, it } from "bun:test";
import { getSupportedReasoningEfforts } from "../src/model-thinking";
import { getBundledModel } from "../src/models";

describe("current subscription model catalog", () => {
	it("bundles Claude Opus 5.5 with official adaptive-thinking metadata", () => {
		const model = getBundledModel("anthropic", "claude-opus-5-5");
		expect(model).toMatchObject({
			name: "Claude Opus 5.5",
			api: "anthropic-messages",
			input: ["text", "image"],
			cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
			contextWindow: 1_000_000,
			maxTokens: 128_000,
			thinking: { mode: "anthropic-adaptive" },
		});
		expect(getSupportedReasoningEfforts(model)).toEqual(["low", "medium", "high", "xhigh", "max"]);
	});

	it.each([
		["gpt-6-luna", { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }],
		["gpt-6-sol", { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
	] as const)("bundles openai-codex/%s with subscription limits and capabilities", (id, cost) => {
		const model = getBundledModel("openai-codex", id);
		expect(model).toMatchObject({
			name: id === "gpt-6-luna" ? "GPT-6 Luna" : "GPT-6 Sol",
			api: "openai-codex-responses",
			input: ["text", "image"],
			cost,
			contextWindow: 272_000,
			maxTokens: 128_000,
		});
		expect(getSupportedReasoningEfforts(model)).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
	});
});
