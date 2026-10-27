import { describe, expect, it } from "bun:test";
import type { Model } from "@f5-sales-demo/pi-ai";
import { filterCurrentBrowserModels } from "../src/config/model-catalog";

describe("GPT-6.1 Terra picker availability", () => {
	it.each(["openai-codex", "litellm"])("keeps Terra when %s advertises it", provider => {
		const terra = { provider, id: "gpt-6.1-terra", name: "GPT-6.1 Terra" } as Model;
		expect(filterCurrentBrowserModels([terra])).toEqual([terra]);
	});

	it("does not synthesize Terra when the gateway catalog omits it", () => {
		const models = [{ provider: "litellm", id: "gpt-6.1-sol", name: "GPT-6.1 Sol" }] as Model[];
		expect(filterCurrentBrowserModels(models)).toEqual(models);
		expect(filterCurrentBrowserModels([])).toEqual([]);
	});
});
