import { describe, expect, test } from "bun:test";
import { DEFAULT_MODEL_PER_PROVIDER, PROVIDER_DESCRIPTORS } from "../src/provider-models/descriptors";

describe("LiteLLM production default", () => {
	test("selects GPT-5.6 Sol when LiteLLM requires provider-level fallback", () => {
		const descriptor = PROVIDER_DESCRIPTORS.find(item => item.providerId === "litellm");
		expect(descriptor?.defaultModel).toBe("gpt-5.6-sol");
		expect(DEFAULT_MODEL_PER_PROVIDER.litellm).toBe("gpt-5.6-sol");
	});
});
