import { describe, expect, it } from "bun:test";
import { applyGeneratedModelPolicies } from "../src/model-thinking";
import { getBundledModels } from "../src/models";
import { MODELS_DEV_PROVIDER_DESCRIPTORS, mapModelsDevToModels } from "../src/provider-models/openai-compat";

describe("gateway catalog operation routing", () => {
	it("maps Cloudflare passthroughs and Workers AI with native identifiers", () => {
		const raw = { name: "Synthetic", tool_call: true, limit: { context: 32000, output: 1000 } };
		const models = mapModelsDevToModels(
			{
				"cloudflare-ai-gateway": {
					models: {
						"openai/gpt-synthetic": raw,
						"anthropic/claude-synthetic": raw,
						"workers-ai/@cf/synthetic": raw,
						"unsupported/synthetic": raw,
					},
				},
			},
			MODELS_DEV_PROVIDER_DESCRIPTORS,
		);
		expect(models.map(model => [model.id, model.api])).toEqual([
			["gpt-synthetic", "openai-responses"],
			["claude-synthetic", "anthropic-messages"],
			["workers-ai/@cf/synthetic", "openai-completions"],
		]);
		expect(models[0]?.baseUrl).toEndWith("/openai");
		expect(models[2]?.baseUrl).toEndWith("/compat");
	});
	it("uses Fireworks Messages except its GLM and Kimi K3 completion endpoints", () => {
		const raw = {
			name: "Synthetic",
			tool_call: true,
			reasoning: true,
			reasoning_options: [{ type: "effort", values: ["high", "max"] }],
		};
		const models = mapModelsDevToModels(
			{
				"fireworks-ai": {
					models: {
						"accounts/fireworks/models/deepseek-v4-pro-0813": raw,
						"accounts/fireworks/models/glm-5p2": raw,
						"accounts/fireworks/models/kimi-k3": raw,
					},
				},
			},
			MODELS_DEV_PROVIDER_DESCRIPTORS,
		);
		applyGeneratedModelPolicies(models, { preserveDiscoveredThinking: true });
		expect(models.map(model => model.api)).toEqual([
			"anthropic-messages",
			"openai-completions",
			"openai-completions",
		]);
		expect(models[0]?.thinking?.mode).toBe("anthropic-adaptive");
		expect(models[0]?.compat).toMatchObject({ allowEmptySignature: true, supportsCacheControlOnTools: false });
		expect(models[1]?.baseUrl).toBe("https://api.fireworks.ai/inference/v1");
		for (const model of getBundledModels("fireworks"))
			expect(model.api).toBe(
				model.id.includes("glm-") || model.id.includes("kimi-k3") ? "openai-completions" : "anthropic-messages",
			);
	});
});
