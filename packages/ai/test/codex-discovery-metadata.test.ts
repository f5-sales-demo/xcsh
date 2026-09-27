import { describe, expect, it, vi } from "bun:test";
import { fetchCodexModels } from "../src/utils/discovery/codex";

const GPT_56_LEVELS = [
	{ effort: "none", description: "Fastest responses with no reasoning tokens" },
	{ effort: "low", description: "Favors speed and fewer reasoning tokens" },
	{ effort: "medium", description: "Balances speed and reasoning depth" },
	{ effort: "high", description: "Favors deeper reasoning" },
	{ effort: "xhigh", description: "Uses very deep reasoning" },
	{ effort: "max", description: "Uses maximum reasoning for the hardest tasks" },
];

describe("Codex model discovery metadata", () => {
	it("merges the pinned GPT-5.6 interaction contract with live catalog presentation", async () => {
		const fetchFn = vi.fn(async (input: string | URL | Request) => {
			if (String(input).includes("registry.npmjs.org")) return Response.json({ version: "0.152.1" });
			return Response.json({
				models: [
					{
						slug: "gpt-5.6-sol",
						display_name: "GPT-5.6 Sol",
						description: "Flagship model for complex professional work",
						default_reasoning_level: "medium",
						supported_reasoning_levels: GPT_56_LEVELS,
						visibility: "list",
						priority: 0,
						supported_in_api: true,
						context_window: 1_050_000,
					},
					{
						slug: "gpt-5.6-terra",
						display_name: "GPT-5.6 Terra",
						description: "Balances intelligence and cost",
						default_reasoning_level: "medium",
						supported_reasoning_levels: GPT_56_LEVELS,
						visibility: "list",
						priority: 1,
						supported_in_api: true,
						context_window: 1_050_000,
					},
					{
						slug: "gpt-5.6-luna",
						display_name: "GPT-5.6 Luna",
						description: "Optimized for cost-sensitive workloads",
						default_reasoning_level: "medium",
						supported_reasoning_levels: GPT_56_LEVELS,
						visibility: "list",
						priority: 2,
						supported_in_api: true,
						context_window: 1_050_000,
					},
				],
			});
		}) as unknown as typeof fetch;

		const result = await fetchCodexModels({ accessToken: "test-token", fetchFn });

		expect(result?.models.map(model => model.id)).toEqual(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
		const expectedEfforts = {
			"gpt-5.6-sol": ["low", "medium", "high", "xhigh", "max", "ultra"],
			"gpt-5.6-terra": ["low", "medium", "high", "xhigh", "max", "ultra"],
			"gpt-5.6-luna": ["low", "medium", "high", "xhigh", "max"],
		} as const;
		const expectedDefaults = { "gpt-5.6-sol": "low", "gpt-5.6-terra": "medium", "gpt-5.6-luna": "medium" } as const;
		for (const model of result?.models ?? []) {
			expect(model).toMatchObject({
				publisher: "OpenAI",
				family: "GPT-5.6",
				visibility: "list",
				providerContextWindow: 1_050_000,
				defaultReasoningSummary: "none",
				defaultVerbosity: "low",
				truncationPolicy: { mode: "tokens", limit: 10_000 },
			});
			expect(model.thinking?.defaultLevel).toBe(expectedDefaults[model.id as keyof typeof expectedDefaults]);
			expect(model.thinking?.supportedLevels.map(level => level.effort)).toEqual([
				...expectedEfforts[model.id as keyof typeof expectedEfforts],
			]);
			expect(model.tier).toBe(model.name.replace("GPT-5.6 ", ""));
		}
		expect(result?.models[0]?.description).toBe("Flagship model for complex professional work");
	});

	it("keeps hidden live entries discoverable but marks their visibility exactly", async () => {
		const fetchFn = vi.fn(async (input: string | URL | Request) => {
			if (String(input).includes("registry.npmjs.org")) return Response.json({ version: "0.152.1" });
			return Response.json({
				models: [
					{
						slug: "gpt-hidden",
						display_name: "Hidden model",
						visibility: "hide",
						supported_in_api: true,
						priority: 99,
						supported_reasoning_levels: [],
					},
				],
			});
		}) as unknown as typeof fetch;

		const result = await fetchCodexModels({ accessToken: "test-token", fetchFn });
		expect(result?.models[0]?.visibility).toBe("hide");
	});
});
