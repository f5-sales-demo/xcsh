import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { createModelManager } from "../src/model-manager";
import { applyGeneratedModelPolicies } from "../src/model-thinking";
import { getBundledModel } from "../src/models";
import {
	MODELS_DEV_PROVIDER_DESCRIPTORS,
	mapModelsDevToModels,
	openrouterModelManagerOptions,
} from "../src/provider-models/openai-compat";
import type { Model } from "../src/types";

describe("provider capability metadata", () => {
	it("keeps advertised reasoning choices through catalog enrichment", () => {
		const models = mapModelsDevToModels(
			{
				baseten: {
					models: {
						synthetic: {
							name: "Synthetic",
							tool_call: true,
							reasoning: true,
							reasoning_options: [{ type: "effort", values: ["high", "max"] }],
						},
					},
				},
			},
			MODELS_DEV_PROVIDER_DESCRIPTORS,
		);
		applyGeneratedModelPolicies(models, { preserveDiscoveredThinking: true });
		expect(models[0]?.thinking?.supportedLevels.map(level => level.effort)).toEqual(["high", "max"]);
	});
	it("rejects a null API resolution instead of reinstating the default", () => {
		expect(
			mapModelsDevToModels({ synthetic: { models: { rejected: { tool_call: true } } } }, [
				{
					modelsDevKey: "synthetic",
					providerId: "synthetic",
					api: "openai-completions",
					baseUrl: "https://api.example.com",
					resolveApi: () => null,
				},
			]),
		).toEqual([]);
	});
	it("retains unknown dynamic prices without reporting a negative cost", async () => {
		using _hook = hookFetch(async () =>
			Response.json({
				data: [
					{
						id: "synthetic",
						supported_parameters: ["tools"],
						pricing: { prompt: "-1", completion: "-1" },
						architecture: { input_modalities: ["text", "image"], modality: "text->text" },
					},
				],
			}),
		);
		const options = openrouterModelManagerOptions({ apiKey: "synthetic" });
		const models = await options.fetchDynamicModels?.();
		expect(models?.[0]?.cost).toMatchObject({ input: 0, output: 0, pricingKnown: false });
		expect(models?.[0]?.input).toEqual(["text", "image"]);
	});
	it("preserves dynamic price uncertainty when merging bundled metadata", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini");
		const manager = createModelManager({
			providerId: "synthetic",
			cacheDbPath: join(mkdtempSync(join(tmpdir(), "synthetic-pricing-")), "models.db"),
			staticModels: [model],
			fetchDynamicModels: async () => [{ ...model, cost: { ...model.cost, pricingKnown: false } }],
		});
		expect((await manager.refresh("online")).models[0]?.cost.pricingKnown).toBe(false);
	});
	it("forwards fallback cancellation and leaves its refresh unpublished", async () => {
		const controller = new AbortController();
		let seen: AbortSignal | undefined;
		const manager = createModelManager({
			providerId: "synthetic",
			cacheDbPath: join(mkdtempSync(join(tmpdir(), "synthetic-fallback-")), "models.db"),
			staticModels: [],
			modelsDev: {
				fetch: async (signal?: AbortSignal) => {
					seen = signal;
					controller.abort();
					signal?.throwIfAborted();
					return [] as Model[];
				},
				map: value => value,
			},
		});
		await expect(manager.refresh("online", { signal: controller.signal })).rejects.toThrow();
		expect(seen).toBe(controller.signal);
	});
});
