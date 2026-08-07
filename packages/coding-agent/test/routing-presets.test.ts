import { describe, expect, it } from "bun:test";
import { BUILTIN_ROUTING_PRESETS, resolveModelPool } from "../src/routing/presets";

describe("Routing Presets (R03)", () => {
	it("should contain standard reviewed presets for OpenAI, Anthropic, and LiteLLM", () => {
		expect(BUILTIN_ROUTING_PRESETS["openai/gpt-5.6"]).toBeDefined();
		expect(BUILTIN_ROUTING_PRESETS["anthropic/claude"]).toBeDefined();
		expect(BUILTIN_ROUTING_PRESETS["litellm/openai"]).toBeDefined();
		expect(BUILTIN_ROUTING_PRESETS["litellm/anthropic"]).toBeDefined();
	});

	it("should resolve pool from explicit selector or anchor model", () => {
		const openaiPool = resolveModelPool("openai/gpt-4o", {});
		expect(openaiPool).toBeDefined();
		expect(openaiPool?.tiers.utility).toBe("gpt-4o-mini");
		expect(openaiPool?.tiers.balanced).toBe("gpt-4o");

		const litellmOpenaiPool = resolveModelPool("litellm/gpt-5.6-terra", {});
		expect(litellmOpenaiPool).toBeDefined();
		expect(litellmOpenaiPool?.tiers.utility).toBe("gpt-5.6-luna");
		expect(litellmOpenaiPool?.tiers.balanced).toBe("gpt-5.6-terra");
		expect(litellmOpenaiPool?.tiers.frontier).toBe("gpt-5.6-sol");
	});

	it("should NOT cross provider families when anchor model has explicit provider prefix", () => {
		const litellmClaudePool = resolveModelPool("litellm/claude-3-5-sonnet-latest", {});
		expect(litellmClaudePool).toBeDefined();
		expect(litellmClaudePool?.id).toBe("litellm/anthropic");
		expect(litellmClaudePool?.provider).toBe("litellm");
	});

	it("should match custom pools when anchor model has provider prefix", () => {
		const customPools = {
			"my-openai": {
				id: "my-openai",
				provider: "openai",
				tiers: {
					utility: "gpt-4o-mini",
					balanced: "gpt-4o",
					frontier: "o3-mini",
				},
			},
		};
		const matched = resolveModelPool("openai/gpt-4o", customPools);
		expect(matched).toBeDefined();
		expect(matched?.id).toBe("my-openai");
	});

	it("should skip custom pools without tiers and not throw TypeError", () => {
		const customPools = {
			"untiered-pool": { id: "untiered-pool", provider: "openai" } as any,
		};
		const pool = resolveModelPool("openai/gpt-4o", customPools);
		expect(pool).toBeDefined();
		expect(pool?.id).toBe("openai/gpt-5.6");
	});

	it("should NOT infer tiers from arbitrary unknown model names", () => {
		const unknownPool = resolveModelPool("my-custom-provider/unknown-model-xyz", {});
		expect(unknownPool).toBeUndefined();
	});
});
