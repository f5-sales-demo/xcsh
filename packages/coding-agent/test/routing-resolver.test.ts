import { describe, expect, it } from "bun:test";
import { resolveTierModel } from "../src/routing/resolver";
import type { RoutingPoolConfig } from "../src/routing/types";

describe("Routing Pool Resolver (R05)", () => {
	const samplePool: RoutingPoolConfig = {
		id: "openai/gpt-5.6",
		provider: "openai",
		tiers: {
			utility: "gpt-4o-mini",
			balanced: "gpt-4o",
			frontier: "o3-mini",
		},
	};

	it("should select exact model when desired tier is available", () => {
		const available = ["gpt-4o-mini", "gpt-4o", "o3-mini"];
		const result = resolveTierModel(samplePool, "utility", available);
		expect(result.selectedModel).toBe("openai/gpt-4o-mini");
		expect(result.effectiveTier).toBe("utility");
		expect(result.degraded).toBe(false);
	});

	it("should promote to next higher tier if desired tier model is missing/unavailable", () => {
		const available = ["gpt-4o", "o3-mini"]; // utility missing!
		const result = resolveTierModel(samplePool, "utility", available);
		expect(result.selectedModel).toBe("openai/gpt-4o");
		expect(result.effectiveTier).toBe("balanced");
	});

	it("should mark pool degraded and pass through if fewer than 2 tiers are available", () => {
		const available = ["o3-mini"]; // only 1 tier available!
		const result = resolveTierModel(samplePool, "balanced", available);
		expect(result.degraded).toBe(true);
		expect(result.selectedModel).toBeUndefined();
	});

	it("should pass through when pool is null or undefined", () => {
		const result = resolveTierModel(undefined, "frontier", ["some-model"]);
		expect(result.selectedModel).toBeUndefined();
		expect(result.degraded).toBe(false);
	});
});
