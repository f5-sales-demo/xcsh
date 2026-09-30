import { describe, expect, it } from "bun:test";
import {
	applyCodexInteractionMetadata,
	CODEX_MODEL_INTERACTION_METADATA,
	getModelEffectiveContextWindow,
	resolveCodexContextBudget,
	resolveCodexWireReasoningEffort,
} from "../src/codex-model-interaction";
import type { Model } from "../src/types";

const EXPECTED = {
	"gpt-6.1-sol": {
		defaultEffort: "medium",
		efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
		tier: "default",
	},
	"gpt-6-astra": {
		defaultEffort: "low",
		efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
		tier: "default",
	},
	"gpt-6-sol": {
		defaultEffort: "medium",
		efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
		tier: "priority",
	},
	"gpt-6-luna": { defaultEffort: "medium", efforts: ["low", "medium", "high", "xhigh", "max"], tier: "priority" },
	"gpt-5.6-sol": {
		defaultEffort: "low",
		efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
		tier: "default",
	},
	"gpt-5.6-terra": {
		defaultEffort: "medium",
		efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
		tier: "default",
	},
	"gpt-5.6-luna": { defaultEffort: "medium", efforts: ["low", "medium", "high", "xhigh", "max"], tier: "default" },
	"gpt-5.5": { defaultEffort: "medium", efforts: ["low", "medium", "high", "xhigh"], tier: "default" },
} as const;

describe("pinned Codex model-interaction metadata", () => {
	it("resolves the effective runtime window without exceeding the selected tier", () => {
		expect(getModelEffectiveContextWindow({ contextWindow: 272_000, effectiveContextWindow: 258_400 })).toBe(258_400);
		expect(getModelEffectiveContextWindow({ contextWindow: 272_000, effectiveContextWindow: 300_000 })).toBe(272_000);
		expect(getModelEffectiveContextWindow({ contextWindow: 272_000 })).toBe(272_000);
	});

	it("does not apply subscription or internal-provider metadata to same-named public API models", () => {
		const model = {
			id: "gpt-5.6-sol",
			name: "GPT-5.6 Sol",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 16_384,
		} satisfies Model<"openai-responses">;
		expect(applyCodexInteractionMetadata(model)).toEqual(model);
	});

	it("covers the exact eight-model interaction contract", () => {
		expect(Object.keys(CODEX_MODEL_INTERACTION_METADATA)).toEqual(Object.keys(EXPECTED));
		for (const [id, expected] of Object.entries(EXPECTED)) {
			const metadata = CODEX_MODEL_INTERACTION_METADATA[id]!;
			expect(metadata).toMatchObject({
				standardContextWindow: 272_000,
				maxContextWindow: id === "gpt-5.5" ? 272_000 : 872_000,
				outputLimit: 128_000,
				effectiveContextWindowPercent: 95,
				autoCompactThresholdPercent: 90,
				defaultReasoningSummary: "none",
				defaultVerbosity: "low",
				defaultServiceTier: expected.tier,
				serviceTiers: ["default", "priority"],
				truncationPolicy: { mode: "tokens", limit: 10_000 },
				supportsParallelToolCalls: true,
			});
			expect(metadata.thinking.defaultLevel).toBe(expected.defaultEffort);
			expect(metadata.thinking.supportedLevels.map(level => level.effort)).toEqual([...expected.efforts]);
		}
	});

	it.each([
		["standard", 272_000, 258_400, 244_800],
		["codex-max", 872_000, 828_400, 784_800],
	] as const)(
		"resolves %s exact context budgets",
		(tier, contextWindow, effectiveContextWindow, autoCompactTokenLimit) => {
			expect(resolveCodexContextBudget("gpt-6-sol", tier, 922_000)).toEqual({
				contextWindow,
				effectiveContextWindow,
				autoCompactTokenLimit,
			});
		},
	);

	it("uses provider-max without exceeding advertised metadata", () => {
		expect(resolveCodexContextBudget("gpt-6-astra", "provider-max", 922_000)?.contextWindow).toBe(922_000);
		expect(resolveCodexContextBudget("gpt-5.6-sol", "provider-max", 1_050_000)?.contextWindow).toBe(1_050_000);
		expect(resolveCodexContextBudget("gpt-5.6-sol", "provider-max", 900_000)?.contextWindow).toBe(900_000);
	});

	it("covers every provider, model, and context tier", () => {
		for (const provider of ["openai-codex", "litellm"] as const) {
			for (const [id, interaction] of Object.entries(CODEX_MODEL_INTERACTION_METADATA)) {
				const advertisedLimit = /^gpt-6(?:\.1)?-/.test(id) ? 922_000 : 1_050_000;
				const api = provider === "openai-codex" ? "openai-codex-responses" : "openai-responses";
				const model = applyCodexInteractionMetadata(
					{
						id,
						name: id,
						api,
						provider,
						baseUrl: "https://provider.example.com/v1",
						reasoning: true,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: advertisedLimit,
						maxTokens: 128_000,
					} as Model,
					advertisedLimit,
				);
				expect(model.providerContextWindow).toBe(advertisedLimit);

				for (const [tier, expectedWindow] of [
					["standard", 272_000],
					["codex-max", interaction.maxContextWindow],
					["provider-max", advertisedLimit],
				] as const) {
					expect(resolveCodexContextBudget(id, tier, model.providerContextWindow)).toEqual({
						contextWindow: expectedWindow,
						effectiveContextWindow: Math.floor(expectedWindow * 0.95),
						autoCompactTokenLimit: Math.floor(expectedWindow * 0.9),
					});
				}
			}
		}
	});

	it("maps the local Ultra selector to each model's pinned wire effort", () => {
		expect(resolveCodexWireReasoningEffort("gpt-6-astra", "ultra")).toBe("xhigh");
		expect(resolveCodexWireReasoningEffort("gpt-6-sol", "ultra")).toBe("max");
		expect(resolveCodexWireReasoningEffort("gpt-6-sol", "high")).toBe("high");
	});

	it("merges interaction metadata by exact model ID while retaining provider raw limits", () => {
		const raw = {
			id: "gpt-6-astra",
			name: "GPT-6 Astra",
			api: "openai-responses",
			provider: "litellm",
			baseUrl: "https://proxy.example.com/openai/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 922_000,
			maxTokens: 4_096,
		} satisfies Model<"openai-responses">;
		const merged = applyCodexInteractionMetadata(raw);
		expect(merged).toMatchObject({
			id: "gpt-6-astra",
			provider: "litellm",
			contextWindow: 272_000,
			providerContextWindow: 922_000,
			maxContextWindow: 872_000,
			maxTokens: 128_000,
			defaultReasoningSummary: "none",
			defaultVerbosity: "low",
			supportsParallelToolCalls: true,
		});
	});

	it("retains a subscription provider limit above the Codex maximum tier", () => {
		const raw = {
			id: "gpt-6-sol",
			name: "GPT-6 Sol",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api/codex",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 272_000,
			maxTokens: 128_000,
		} satisfies Model<"openai-codex-responses">;
		const merged = applyCodexInteractionMetadata(raw, 922_000);
		expect(merged.providerContextWindow).toBe(922_000);
		expect(resolveCodexContextBudget(merged.id, "codex-max", merged.providerContextWindow)?.contextWindow).toBe(
			872_000,
		);
		expect(resolveCodexContextBudget(merged.id, "provider-max", merged.providerContextWindow)?.contextWindow).toBe(
			922_000,
		);
	});
});
