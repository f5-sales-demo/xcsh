import { describe, expect, it } from "bun:test";
import type { Model } from "@f5-sales-demo/pi-ai";
import { parse } from "yaml";
import { generateModelsYml } from "../src/config/auto-config";
import { filterCurrentBrowserModels } from "../src/config/model-catalog";
import { DEFAULT_MODEL_ROLES } from "../src/config/settings-schema";

describe("GPT-6.1 Sol configuration", () => {
	it("generates v12 with Sol Responses, valid efforts, zero cost and endpoint prefixes", () => {
		const config = parse(
			generateModelsYml("https://proxy.example.com", { apiBasePath: "/api/v1", apiKeyLiteral: "synthetic-key" }),
		);
		expect(config.configVersion).toBe(12);
		const provider = config.providers.litellm;
		expect(provider.apiKey).toBe("synthetic-key");
		expect(provider.baseUrl).toBe("https://proxy.example.com/api/v1");
		expect(provider.modelAllowlist).toContain("gpt-6.1-sol");
		expect(provider.models.find((model: any) => model.id === "gpt-6.1-sol")).toMatchObject({
			api: "openai-responses",
			baseUrl: "https://proxy.example.com/openai/v1",
		});
		expect(provider.modelOverrides["gpt-6.1-sol"].thinking.supportedLevels.map((level: any) => level.effort)).toEqual(
			["low", "medium", "high", "xhigh", "max"],
		);
	});
	it("uses Sol for main, slow and plan while preserving the small role", () => {
		expect(DEFAULT_MODEL_ROLES).toMatchObject({
			default: "litellm/gpt-6.1-sol:medium",
			slow: "litellm/gpt-6.1-sol:high",
			plan: "litellm/gpt-6.1-sol:high",
			smol: "litellm/gpt-6-luna:low",
		});
	});
	it("shows an advertised Sol in both existing picker groups", () => {
		const models = ["litellm", "openai-codex"].map(provider => ({ provider, id: "gpt-6.1-sol" }) as Model);
		expect(filterCurrentBrowserModels(models)).toEqual(models);
	});
});
