import { expect, it } from "bun:test";
import type { Model } from "@f5-sales-demo/pi-ai";
import { getLoginRecommendation } from "../src/modes/controllers/login-model";

const model: Model = {
	id: "kiro/claude-haiku-4.5",
	name: "Haiku",
	provider: "kiro",
	api: "kiro-api",
	providerDefault: true,
	baseUrl: "https://q.us-east-1.amazonaws.com/generateAssistantResponse",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 64000,
};
it("recommends only the discovered available service default", () => {
	const registry = {
		getAll: () => [model],
		getProviderDiscoveryState: () => ({ status: "ok", stale: false, models: [model.id] }),
	};
	expect(getLoginRecommendation(registry, "kiro")?.modelId).toBe(model.id);
	for (const state of [
		{ status: "cached", stale: false, models: [model.id] },
		{ status: "ok", stale: true, models: [model.id] },
		{ status: "ok", stale: false, models: [] },
	])
		expect(getLoginRecommendation({ ...registry, getProviderDiscoveryState: () => state }, "kiro")).toBeUndefined();
});
