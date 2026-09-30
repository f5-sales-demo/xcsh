import { describe, expect, it } from "bun:test";
import { calculateCost, getBundledModel } from "../src/models";
import type { Usage } from "../src/types";

describe("calculateCost", () => {
	it("distinguishes subscription, internal and unknown API dollar estimates", () => {
		const usage: Usage = {
			input: 10,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 11,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		for (const provider of ["openai-codex", "litellm"]) {
			calculateCost(getBundledModel(provider as "litellm", "gpt-6.1-sol"), usage);
			expect(usage.billing).toBe(provider === "litellm" ? "internal" : "subscription");
			expect(usage.cost.total).toBe(0);
		}
		calculateCost(
			{ provider: "openrouter", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, pricingKnown: false } },
			usage,
		);
		expect(usage.costKnown).toBe(false);
	});
	it("keeps token-based calculation for GitHub Copilot models", () => {
		const model = {
			...getBundledModel("github-copilot", "gpt-4o"),
			cost: {
				input: 1000,
				output: 2000,
				cacheRead: 500,
				cacheWrite: 800,
			},
		};
		const usage: Usage = {
			input: 1000,
			output: 500,
			cacheRead: 200,
			cacheWrite: 100,
			totalTokens: 1800,
			cost: {
				input: 123,
				output: 456,
				cacheRead: 789,
				cacheWrite: 321,
				total: 1689,
			},
		};

		calculateCost(model, usage);

		expect(usage.cost.input).toBeCloseTo(1, 8);
		expect(usage.cost.output).toBeCloseTo(1, 8);
		expect(usage.cost.cacheRead).toBeCloseTo(0.1, 8);
		expect(usage.cost.cacheWrite).toBeCloseTo(0.08, 8);
		expect(usage.cost.total).toBeCloseTo(2.18, 8);
	});

	it("keeps token-based calculation for non-Copilot providers", () => {
		const model = {
			...getBundledModel("openai", "gpt-4o-mini"),
			cost: {
				input: 1000,
				output: 2000,
				cacheRead: 500,
				cacheWrite: 800,
			},
		};
		const usage: Usage = {
			input: 1000,
			output: 500,
			cacheRead: 200,
			cacheWrite: 100,
			totalTokens: 1800,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		};

		calculateCost(model, usage);

		expect(usage.cost.input).toBeCloseTo(1, 8);
		expect(usage.cost.output).toBeCloseTo(1, 8);
		expect(usage.cost.cacheRead).toBeCloseTo(0.1, 8);
		expect(usage.cost.cacheWrite).toBeCloseTo(0.08, 8);
		expect(usage.cost.total).toBeCloseTo(2.18, 8);
	});
});
