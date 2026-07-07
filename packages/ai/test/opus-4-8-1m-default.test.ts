import { describe, expect, it } from "bun:test";
import { buildAnthropicClientOptions, getBundledModel, type Model } from "@f5-sales-demo/pi-ai";

const anthropicModel = (id: string): Model<"anthropic-messages"> =>
	getBundledModel("anthropic", id) as Model<"anthropic-messages">;

/**
 * Regression coverage for the F5 LiteLLM pre-release default model.
 *
 * The gateway serves `claude-opus-4-8` (the `[1m]` in ANTHROPIC_DEFAULT_OPUS_MODEL
 * is a Claude-Code client convention, not a gateway id). 1M context is unlocked by
 * the `context-1m-2025-08-07` anthropic-beta header, not by an id suffix. These tests
 * pin the catalog entry and prove the per-model `betas` field reaches the wire header
 * without clobbering interleaved-thinking.
 */
const CONTEXT_1M_BETA = "context-1m-2025-08-07";

describe("claude-opus-4-8 (F5 1M default)", () => {
	it("exists in the anthropic catalog with a 1M context window", () => {
		const model = getBundledModel("anthropic", "claude-opus-4-8");
		expect(model).toBeDefined();
		expect(model.id).toBe("claude-opus-4-8");
		expect(model.provider).toBe("anthropic");
		expect(model.api).toBe("anthropic-messages");
		expect(model.contextWindow).toBe(1_000_000);
	});

	it("carries the 1M context beta as a per-model beta", () => {
		const model = getBundledModel("anthropic", "claude-opus-4-8");
		expect(model.betas).toContain(CONTEXT_1M_BETA);
	});

	it("sends the 1M beta on the wire and still composes with interleaved-thinking", () => {
		const options = buildAnthropicClientOptions({
			model: anthropicModel("claude-opus-4-8"),
			apiKey: "sk-ant-oat-test",
			extraBetas: [],
			stream: true,
			interleavedThinking: true,
			dynamicHeaders: {},
		});
		const beta = options.defaultHeaders["Anthropic-Beta"];
		expect(beta).toContain(CONTEXT_1M_BETA);
		expect(beta).toContain("interleaved-thinking-2025-05-14");
	});

	it("does not inject the 1M beta for models that do not opt in", () => {
		const options = buildAnthropicClientOptions({
			model: anthropicModel("claude-sonnet-4-6"),
			apiKey: "sk-ant-oat-test",
			extraBetas: [],
			stream: true,
			interleavedThinking: false,
			dynamicHeaders: {},
		});
		const beta = options.defaultHeaders["Anthropic-Beta"] ?? "";
		expect(beta).not.toContain(CONTEXT_1M_BETA);
	});
});
