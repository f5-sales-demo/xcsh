import { describe, expect, it } from "bun:test";
import { calculateCost, getBundledModel } from "../src/models";
import { MODELS_DEV_PROVIDER_DESCRIPTORS, mapModelsDevToModels } from "../src/provider-models/openai-compat";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import { processResponsesStream } from "../src/providers/openai-responses-shared";
import type { AssistantMessage, Model, Usage } from "../src/types";
import { AssistantMessageEventStream } from "../src/utils/event-stream";

const usage = (input = 272_000): Usage => ({
	input,
	output: 1000,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: input + 1000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});
describe("Responses modernization", () => {
	it("preserves upstream request-wide pricing tiers during catalog generation", () => {
		const [model] = mapModelsDevToModels(
			{
				openai: {
					models: {
						synthetic: {
							name: "Synthetic",
							tool_call: true,
							cost: {
								input: 2,
								output: 10,
								cache_read: 0.1,
								cache_write: 2.5,
								tiers: [
									{
										tier: { type: "context", size: 272000 },
										input: 4,
										output: 15,
										cache_read: 0.2,
										cache_write: 5,
									},
								],
							},
						},
					},
				},
			},
			MODELS_DEV_PROVIDER_DESCRIPTORS,
		);
		expect(model?.cost.tiers).toEqual([
			{ inputTokensAbove: 272000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 },
		]);
	});
	it("prices the full request above the input threshold including cache reads and writes", () => {
		const model = getBundledModel("openai", "gpt-6.1-sol");
		const standard = usage();
		calculateCost(model, standard);
		expect(standard.cost.output).toBeCloseTo(0.01);
		const large = { ...usage(270_000), cacheRead: 2000, cacheWrite: 1 };
		calculateCost(model, large);
		expect(large.cost.input).toBeCloseTo(1.08);
		expect(large.cost.output).toBeCloseTo(0.015);
		expect(large.cost.cacheRead).toBeCloseTo(0.0004);
		expect(large.cost.cacheWrite).toBeCloseTo(0.000005);
		calculateCost(
			{ ...model, provider: "litellm", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
			large,
		);
		expect(large.cost.total).toBe(0);
	});
	it("separates reported cache reads and writes and reasoning tokens", async () => {
		const model = getBundledModel("openai", "gpt-6.1-sol");
		const output: AssistantMessage = {
			role: "assistant",
			api: model.api,
			provider: model.provider,
			model: model.id,
			content: [],
			usage: usage(0),
			stopReason: "stop",
			timestamp: 0,
		};
		async function* events() {
			yield {
				type: "response.completed",
				response: {
					status: "completed",
					usage: {
						input_tokens: 1000,
						output_tokens: 100,
						total_tokens: 1100,
						input_tokens_details: { cached_tokens: 600, cache_write_tokens: 200 },
						output_tokens_details: { reasoning_tokens: 50 },
					},
				},
			};
		}
		await processResponsesStream(events() as any, output, new AssistantMessageEventStream(), model);
		expect(output.usage).toMatchObject({
			input: 200,
			cacheRead: 600,
			cacheWrite: 200,
			output: 100,
			reasoningTokens: 50,
			totalTokens: 1100,
		});
	});
	it("uses modern caching without a session key and keeps breakpoints on content blocks", async () => {
		let payload: any;
		await streamOpenAIResponses(
			getBundledModel("openai", "gpt-6.1-sol") as Model<"openai-responses">,
			{
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "Synthetic context", promptCacheBreakpoint: { mode: "explicit" } }],
						timestamp: 0,
					},
				],
			},
			{
				apiKey: "synthetic",
				promptCache: { mode: "explicit", ttl: "30m" },
				signal: AbortSignal.abort(),
				onPayload: value => {
					payload = value;
				},
			},
		).result();
		expect(payload.prompt_cache_options).toEqual({ mode: "explicit", ttl: "30m" });
		expect(payload).not.toHaveProperty("prompt_cache_retention");
		expect(payload.input[0].content[0].prompt_cache_breakpoint).toEqual({ mode: "explicit" });
	});
});
