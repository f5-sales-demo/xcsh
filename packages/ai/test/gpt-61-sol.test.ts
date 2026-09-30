import { describe, expect, it } from "bun:test";
import { applyCodexInteractionMetadata, resolveCodexContextBudget } from "../src/codex-model-interaction";
import { Effort, enrichModelThinking, requireSupportedReasoningEffort } from "../src/model-thinking";
import { getBundledModel } from "../src/models";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import { mapOptionsForApi } from "../src/stream";
import type { Model } from "../src/types";

const apiModel = (): Model<"openai-responses"> =>
	enrichModelThinking({
		id: "gpt-6.1-sol",
		name: "GPT-6.1 Sol",
		provider: "openai",
		api: "openai-responses",
		baseUrl: "https://api.openai.com/v1",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 1_050_000,
		maxTokens: 128_000,
		cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
	});

describe("GPT-6.1 Sol contract", () => {
	it("preserves API max through the public simple stream mapping", () => {
		expect(mapOptionsForApi(apiModel(), { reasoning: Effort.Max })).toMatchObject({ reasoning: "max" });
	});
	it("bundles each route with API limits separate from subscription limits", () => {
		expect(getBundledModel("openai", "gpt-6.1-sol")).toMatchObject({
			api: "openai-responses",
			contextWindow: 1_050_000,
			maxInputTokens: 922_000,
			maxTokens: 128_000,
			input: ["text", "image"],
			cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
		});
		expect(getBundledModel("openai-codex", "gpt-6.1-sol")).toMatchObject({
			contextWindow: 272_000,
			maxContextWindow: 872_000,
			defaultServiceTier: "default",
		});
		expect(getBundledModel("litellm", "gpt-6.1-sol")).toMatchObject({
			api: "openai-responses",
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		});
	});
	it("rejects invalid API efforts while allowing every supported level", () => {
		const model = apiModel();
		for (const effort of ["low", "medium", "high", "xhigh", "max"] as const)
			expect(requireSupportedReasoningEffort(model, effort)).toBe(effort);
		for (const effort of ["none", "minimal", "ultra"] as const)
			expect(() => requireSupportedReasoningEffort(model, effort)).toThrow("not supported");
		expect(model.thinking?.defaultLevel).toBe("medium");
	});
	it("preserves discovered presets and default separately from role overrides", () => {
		const thinking = {
			mode: "effort" as const,
			defaultLevel: "high" as const,
			supportedLevels: [
				{ effort: "high" as const, description: "Discovered high" },
				{ effort: "ultra" as const, description: "Discovered Ultra" },
			],
		};
		const model = applyCodexInteractionMetadata({
			...apiModel(),
			api: "openai-codex-responses",
			provider: "openai-codex",
			thinking,
			providerContextWindow: 800_000,
		});
		expect(model.thinking).toEqual(thinking);
		expect(resolveCodexContextBudget(model.id, "codex-max", model.providerContextWindow)?.contextWindow).toBe(
			800_000,
		);
		expect(resolveCodexContextBudget(model.id, "standard", 200_000)?.effectiveContextWindow).toBe(190_000);
	});
	it("sanitizes the final payload after an asynchronous hook and omits summary none", async () => {
		let payload: any;
		const result = await streamOpenAIResponses(
			apiModel(),
			{ messages: [{ role: "user", content: "Synthetic probe", timestamp: 0 }] },
			{
				apiKey: "synthetic",
				reasoning: "max",
				reasoningSummary: "none",
				onPayload: async value => {
					await Promise.resolve();
					payload = { ...(value as object), temperature: 1, top_p: 0.5, logprobs: true, top_logprobs: 5 };
					return payload;
				},
				signal: AbortSignal.abort(),
			},
		).result();
		expect(result.stopReason).toBe("aborted");
		expect(payload.reasoning).toEqual({ effort: "max" });
		for (const key of ["temperature", "top_p", "logprobs", "top_logprobs"]) expect(payload).not.toHaveProperty(key);
	});
});
