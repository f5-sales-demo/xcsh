import { describe, expect, it } from "bun:test";
import { buildAnthropicClientOptions, getBundledModel, type Model } from "@f5-sales-demo/pi-ai";

const anthropicModel = (id: string): Model<"anthropic-messages"> =>
	getBundledModel("anthropic", id) as Model<"anthropic-messages">;

/**
 * Regression coverage for the F5 LiteLLM default models.
 *
 * The gateway serves `claude-opus-5` / `claude-sonnet-5` (the `[1m]` suffix seen in
 * `ANTHROPIC_DEFAULT_OPUS_MODEL` is a Claude-Code client convention, not a gateway
 * id — the literal id is rejected with `400 Invalid model name`). 1M context is
 * expressed by the catalog entry, and the `context-1m-2025-08-07` anthropic-beta
 * header is carried per-model. Verified against `GET /openai/model/info`: both
 * models are 1,000,000 in / 128,000 out.
 *
 * These tests pin the catalog entries and prove the per-model `betas` field reaches
 * the wire header without clobbering interleaved-thinking.
 */
const CONTEXT_1M_BETA = "context-1m-2025-08-07";

describe.each([
	["claude-opus-5", "Claude Opus 5"],
	["claude-sonnet-5", "Claude Sonnet 5"],
])("%s (F5 1M default)", (id, name) => {
	it("exists in the anthropic catalog with a 1M context window and 128k output", () => {
		const model = getBundledModel("anthropic", id);
		expect(model).toBeDefined();
		expect(model.id).toBe(id);
		expect(model.name).toBe(name);
		expect(model.provider).toBe("anthropic");
		expect(model.api).toBe("anthropic-messages");
		expect(model.contextWindow).toBe(1_000_000);
		expect(model.maxTokens).toBe(128_000);
	});

	it("carries the 1M context beta as a per-model beta", () => {
		expect(getBundledModel("anthropic", id).betas).toContain(CONTEXT_1M_BETA);
	});

	it("advertises adaptive thinking up to max (the top of the API enum)", () => {
		expect(getBundledModel("anthropic", id).thinking).toMatchObject({
			mode: "anthropic-adaptive",
			minLevel: "minimal",
			maxLevel: "max",
		});
	});

	it("sends the 1M beta on the wire and still composes with interleaved-thinking", () => {
		const options = buildAnthropicClientOptions({
			model: anthropicModel(id),
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
});

describe("models that do not opt into the 1M beta", () => {
	it("does not inject the 1M beta for a non-opted model", () => {
		const options = buildAnthropicClientOptions({
			model: anthropicModel("claude-sonnet-4-6"),
			apiKey: "sk-ant-oat-test",
			extraBetas: [],
			stream: true,
			interleavedThinking: false,
			dynamicHeaders: {},
		});
		expect(options.defaultHeaders["Anthropic-Beta"] ?? "").not.toContain(CONTEXT_1M_BETA);
	});
});
