import { afterEach, describe, expect, it, vi } from "bun:test";
import { Messages } from "@anthropic-ai/sdk/resources/messages/messages";
import { CURRENT_ANTHROPIC_MODELS } from "../src/current-anthropic-models";
import { enrichModelThinking } from "../src/model-thinking";
import { convertAnthropicMessages, streamAnthropic } from "../src/providers/anthropic";
import type { AssistantMessageEvent, Model } from "../src/types";

const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-5-5",
	name: "Sonnet 5.5",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	contextWindow: 200000,
	maxTokens: 8192,
};

async function run(
	blocks: Record<string, unknown>[],
	options: Record<string, unknown> = {},
	usage: Record<string, unknown> = {},
	startUsage: Record<string, unknown> = {},
	selectedModel = model,
) {
	const events = [
		{
			type: "message_start",
			message: {
				id: "msg_native",
				model: selectedModel.id,
				usage: { input_tokens: 20, output_tokens: 0, ...startUsage },
			},
		},
		...blocks.flatMap((content_block, index) => [
			{ type: "content_block_start", index, content_block },
			{ type: "content_block_stop", index },
		]),
		{
			type: "message_delta",
			delta: { stop_reason: options.anthropicCompaction ? "compaction" : "tool_use" },
			usage: { output_tokens: 10, ...usage },
		},
		{ type: "message_stop" },
	];
	let request: any;
	let requestCount = 0;
	vi.spyOn(Messages.prototype, "create").mockImplementation((value: any) => {
		request = value;
		requestCount++;
		return {
			async withResponse() {
				return {
					data: {
						async *[Symbol.asyncIterator]() {
							yield* events;
						},
					},
					response: new Response(null, { status: 200, headers: { "request-id": "req_native" } }),
				};
			},
		} as never;
	});
	const stream = streamAnthropic(
		selectedModel,
		{ messages: [{ role: "user", content: "Do the canary task.", timestamp: 1 }] },
		{ apiKey: "test-key", ...options },
	);
	const received: AssistantMessageEvent[] = [];
	for await (const event of stream) received.push(event);
	return { result: await stream.result(), events: received, request, requestCount };
}

afterEach(() => vi.restoreAllMocks());

describe("Anthropic native replay and fallback", () => {
	it.each(["standard", "fast"])(
		"honors an explicit standard fallback with initial %s speed without dispatching discarded tools",
		async initialSpeed => {
			const primary = enrichModelThinking(CURRENT_ANTHROPIC_MODELS.find(record => record.id === "claude-opus-5-5")!);
			const target = "claude-opus-5";
			const boundary = { type: "fallback", from: { model: primary.id }, to: { model: target } };
			const { result, events, request } = await run(
				[
					{ type: "tool_use", id: "discarded_fast", name: "counter", input: { increment: 1 } },
					boundary,
					{ type: "tool_use", id: "served_standard", name: "counter", input: { increment: 2 } },
				],
				{ serviceTier: "priority", fallbacks: [{ model: target, speed: "standard" }] },
				{
					speed: "standard",
					iterations: [
						{ type: "message", model: primary.id, input_tokens: 20, output_tokens: 0 },
						{ type: "fallback_message", model: target, input_tokens: 20, output_tokens: 10 },
					],
				},
				{ speed: initialSpeed },
				primary,
			);
			expect(request.speed).toBe("fast");
			expect(request.fallbacks).toEqual([{ model: target, speed: "standard" }]);
			expect(result.stopReason).toBe("toolUse");
			expect(result.responseAttribution?.responseModel).toBe(target);
			expect(result.usage.inferenceSpeed).toBe("standard");
			expect(result.usage.costKnown).toBe(false);
			expect(events.filter(event => event.type === "toolcall_end").map(event => event.toolCall.id)).toEqual([
				"served_standard",
			]);
		},
	);
	it("does not excuse an unhonored fast primary merely because a standard fallback was configured", async () => {
		const { result } = await run(
			[{ type: "tool_use", id: "unhonored", name: "counter", input: {} }],
			{ serviceTier: "priority", fallbacks: [{ model: "claude-opus-5", speed: "standard" }] },
			{},
			{ speed: "standard" },
		);
		expect(result.stopReason).toBe("error");
		expect(result.providerFailureCode).toBe("fast_mode_not_honored");
	});
	it("rejects an unexpected fast fallback without retrying or dispatching its tools", async () => {
		const primary = enrichModelThinking(CURRENT_ANTHROPIC_MODELS.find(record => record.id === "claude-opus-5-5")!);
		const target = "claude-opus-5";
		const { result, events, requestCount } = await run(
			[{ type: "fallback", from: { model: primary.id }, to: { model: target } }],
			{ serviceTier: "priority", fallbacks: [{ model: target, speed: "standard" }] },
			{
				speed: "fast",
				iterations: [{ type: "fallback_message", model: target, input_tokens: 20, output_tokens: 0 }],
			},
			{ speed: "fast" },
			primary,
		);
		expect(result.stopReason).toBe("error");
		expect(result.providerFailureCode).toBe("inference_speed_not_honored");
		expect(result.usage.inferenceSpeed).toBe("fast");
		expect(requestCount).toBe(1);
		expect(events.some(event => event.type === "toolcall_end")).toBe(false);
	});
	it("rejects reported standard speed when fast mode was explicitly requested", async () => {
		const events = [
			{
				type: "message_start",
				message: {
					id: "msg_slow",
					model: model.id,
					usage: { input_tokens: 1, output_tokens: 0, speed: "standard" },
				},
			},
		];
		vi.spyOn(Messages.prototype, "create").mockImplementation(
			() =>
				({
					async withResponse() {
						return {
							data: {
								async *[Symbol.asyncIterator]() {
									yield* events;
								},
							},
							response: new Response(null, { status: 200 }),
						};
					},
				}) as never,
		);
		const result = await streamAnthropic(
			model,
			{ messages: [{ role: "user", content: "synthetic", timestamp: 1 }] },
			{ apiKey: "test", serviceTier: "priority" },
		).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("fast mode");
		expect(result.usage.inferenceSpeed).toBe("standard");
	});
	it("keeps signed compaction bytes and opaque tool changes for exact replay", async () => {
		const block = {
			type: "compaction",
			content: "Exact summary\r\ncanary=玉",
			signature: "signed-by-provider",
			tool_changes: [{ type: "tool_removal", tool: { type: "tool_reference", name: "old" } }],
		};
		const { result } = await run([block], { anthropicCompaction: {} });
		expect(result.stopReason).toBe("stop");
		expect(result.rawStopReason).toBe("compaction");
		const replay = convertAnthropicMessages([result], model, false);
		expect(replay[0].content as unknown).toEqual([block]);
	});

	it("dispatches only fallback tools and records the served model", async () => {
		const first = { type: "tool_use", id: "discarded", name: "counter", input: { increment: 1 } };
		const boundary = { type: "fallback", from: { model: model.id }, to: { model: "claude-haiku-5-5" } };
		const last = { type: "tool_use", id: "served", name: "counter", input: { increment: 2 } };
		const { result, events } = await run(
			[first, boundary, last],
			{
				fallbacks: [{ model: "claude-haiku-5-5", cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } }],
			},
			{
				iterations: [
					{ type: "message", model: model.id, input_tokens: 20, output_tokens: 5 },
					{ type: "fallback_message", model: "claude-haiku-5-5", input_tokens: 20, output_tokens: 5 },
				],
			},
		);
		expect(result.stopReason).toBe("toolUse");
		expect(events.filter(e => e.type === "toolcall_end").map(e => e.toolCall.id)).toEqual(["served"]);
		expect(result.content.filter(b => b.type === "toolCall").map(b => b.id)).toEqual(["served"]);
		expect(result.responseAttribution?.responseModel).toBe("claude-haiku-5-5");
		expect(result.usage.input).toBe(40);
		expect(result.usage.output).toBe(10);
		expect(result.usage.cost.input).toBeCloseTo((20 * 3 + 20 * 0.1) / 1_000_000, 10);
		expect(convertAnthropicMessages([result], model, false)[0].content as unknown).toEqual([first, boundary, last]);
	});

	it("keeps provider web-fetch results out of client tool dispatch while preserving exact history", async () => {
		const use = { type: "server_tool_use", id: "fetch_1", name: "web_fetch", input: { url: "https://example.com" } };
		const fetched = {
			type: "web_fetch_tool_result",
			tool_use_id: "fetch_1",
			content: {
				type: "web_fetch_result",
				url: "https://example.com",
				content: { type: "document", source: { type: "text", media_type: "text/plain", data: "source" } },
			},
		};
		const { result, events } = await run([use, fetched]);
		expect(result.content.some(b => b.type === "toolCall")).toBe(false);
		expect(events.some(e => e.type === "server_tool_end" && e.toolName === "web_fetch")).toBe(true);
		expect(convertAnthropicMessages([result], model, false)[0].content as unknown).toEqual([use, fetched]);
	});
});
