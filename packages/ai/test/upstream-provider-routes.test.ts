import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getBundledModels } from "../src/models";
import { PROVIDER_DESCRIPTORS } from "../src/provider-models/descriptors";
import { MODELS_DEV_PROVIDER_DESCRIPTORS, mapModelsDevToModels } from "../src/provider-models/openai-compat";
import { UPSTREAM_PROVIDER_ROUTES } from "../src/provider-models/upstream-providers";

describe("additive upstream provider identities", () => {
	it("bundles Ant Ling models and assigns Mistral native transport", () => {
		expect(getBundledModels("ant-ling").map(model => model.id)).toEqual([
			"Ling-2.6-flash",
			"Ling-2.6-1T",
			"Ring-2.6-1T",
		]);
		for (const model of getBundledModels("mistral")) expect(model.api).toBe("mistral-conversations");
	});
	it("loads the public Radius config and preserves its gateway route", async () => {
		using _hook = hookFetch(async () =>
			Response.json({
				baseUrl: "https://gateway.example.com/prefix",
				models: [
					{
						id: "synthetic",
						name: "Synthetic",
						reasoning: false,
						input: ["text"],
						contextWindow: 32000,
						maxTokens: 1000,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					},
				],
			}),
		);
		const options = PROVIDER_DESCRIPTORS.find(
			provider => provider.providerId === "radius",
		)!.createModelManagerOptions({});
		expect(options.fetchDynamicModels).toBeDefined();
		expect(await options.fetchDynamicModels?.()).toMatchObject([
			{ provider: "radius", api: "pi-messages", baseUrl: "https://gateway.example.com/prefix" },
		]);
	});
	it("maps upstream catalog aliases to existing xcsh provider identities", () => {
		const raw = {
			models: { synthetic: { name: "Synthetic", tool_call: true, limit: { context: 32000, output: 1000 } } },
		};
		const models = mapModelsDevToModels(
			{ "fireworks-ai": raw, "alibaba-token-plan": raw, "alibaba-token-plan-cn": raw },
			MODELS_DEV_PROVIDER_DESCRIPTORS,
		);
		for (const provider of ["fireworks", "qwen-token-plan", "qwen-token-plan-cn", "qwen-token-plan-individual"])
			expect(models.some(model => model.provider === provider && model.id === "synthetic")).toBe(true);
	});
	it("registers each added provider without replacing existing identities", () => {
		const ids = PROVIDER_DESCRIPTORS.map(provider => provider.providerId);
		expect(new Set(ids).size).toBe(ids.length);
		for (const route of UPSTREAM_PROVIDER_ROUTES) expect(ids).toContain(route.providerId);
		for (const id of ["moonshot", "kimi-code", "opencode-zen", "litellm"] as const) expect(ids).toContain(id);
	});
});
