import { afterEach, expect, it, vi } from "bun:test";
import { APIError } from "@anthropic-ai/sdk";
import { Messages } from "@anthropic-ai/sdk/resources/messages/messages";
import { streamAnthropic } from "../src/providers/anthropic";
import { applyAnthropicIterationUsage } from "../src/providers/anthropic-native-history";
import type { Context, Model, ProviderSessionState, Usage } from "../src/types";

const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-5-5",
	name: "Sonnet",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	contextWindow: 200000,
	maxTokens: 8192,
	compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true, supportsMidConvoEffort: true },
};
const initial: Context = { messages: [{ role: "user", content: "synthetic", timestamp: 1 }] };
function empty(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}
function install(
	startUsage: Record<string, unknown> = {},
	reject?: (body: any, attempt: number) => APIError | undefined,
) {
	const bodies: any[] = [];
	vi.spyOn(Messages.prototype, "create").mockImplementation((body: any) => {
		bodies.push(structuredClone(body));
		const attempt = bodies.length;
		return {
			async withResponse() {
				const error = reject?.(body, attempt);
				if (error) throw error;
				return {
					data: {
						async *[Symbol.asyncIterator]() {
							yield {
								type: "message_start",
								message: {
									id: `msg_${attempt}`,
									model: model.id,
									usage: { input_tokens: 1, output_tokens: 0, ...startUsage },
								},
							};
							yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
							yield {
								type: "content_block_delta",
								index: 0,
								delta: { type: "text_delta", text: "synthetic reply" },
							};
							yield { type: "content_block_stop", index: 0 };
							yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } };
							yield { type: "message_stop" };
						},
					},
					response: new Response(null, { status: 200 }),
				};
			},
		} as never;
	});
	return bodies;
}
afterEach(() => vi.restoreAllMocks());
it("forwards fallback generation overrides and excludes only local cost", async () => {
	const bodies = install();
	const target = {
		model: "claude-haiku-5-5",
		speed: "fast",
		output_config: { effort: "high", task_budget: { type: "tokens", total: 100 } },
		cost: model.cost,
	};
	await streamAnthropic(model, initial, { apiKey: "test", fallbacks: [target] as any }).result();
	const { cost: _, ...wire } = target;
	expect(bodies[0].fallbacks).toEqual([wire]);
});
it("marks unknown fallback pricing without charging the requested model rate", () => {
	const usage = empty();
	applyAnthropicIterationUsage(
		{ iterations: [{ type: "fallback_message", model: "unknown-model", input_tokens: 100, output_tokens: 2 }] },
		usage,
		model,
		[{ model: "unknown-model" }],
	);
	expect(usage.costKnown).toBe(false);
	expect(usage.cost.total).toBe(0);
	expect(usage.totalTokens).toBe(102);
});
it("prices one-hour cache writes at twice base input while preserving token counts", async () => {
	install({
		cache_creation_input_tokens: 150,
		cache_creation: { ephemeral_5m_input_tokens: 50, ephemeral_1h_input_tokens: 100 },
	});
	const result = await streamAnthropic(model, initial, { apiKey: "test", cacheRetention: "long" }).result();
	expect(result.usage.cacheWrite).toBe(150);
	expect(result.usage.cost.cacheWrite).toBeCloseTo((50 * 3.75 + 100 * 6) / 1e6, 10);
	expect(result.usage.cacheCreation).toEqual({ ephemeral5m: 50, ephemeral1h: 100 });
});
it("honors iteration usage already reported at message start", async () => {
	install({
		iterations: [
			{ type: "message", model: model.id, input_tokens: 33, output_tokens: 0 },
			{ type: "fallback_message", model: "claude-haiku-5-5", input_tokens: 33, output_tokens: 0 },
		],
	});
	const result = await streamAnthropic(model, initial, {
		apiKey: "test",
		fallbacks: [{ model: "claude-haiku-5-5", cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } }],
	}).result();
	expect(result.responseAttribution?.responseModel).toBe("claude-haiku-5-5");
});
it("recreates a rejected continuation once with full history and retains threading", async () => {
	const bodies = install({}, body =>
		body.thread?.type === "continue"
			? APIError.generate(
					400,
					{
						error: {
							type: "invalid_request_error",
							message: "Thread lost",
							details: { error_code: "thread_not_found" },
						},
					},
					undefined,
					new Headers(),
				)
			: undefined,
	);
	const state = new Map<string, ProviderSessionState>();
	const options = { apiKey: "test", messageThreads: true, sessionId: "stale-canary", providerSessionState: state };
	const context = structuredClone(initial);
	const first = await streamAnthropic(model, context, options).result();
	context.messages.push(first, { role: "user", content: "next", timestamp: 2 });
	const result = await streamAnthropic(model, context, options).result();
	expect(result.stopReason).toBe("stop");
	expect(bodies.map(b => b.thread.type)).toEqual(["create", "continue", "create"]);
	expect(bodies[2].messages).toHaveLength(3);
});
it("fails a repeated thread rejection without stripping the thread or retrying indefinitely", async () => {
	const bodies = install({}, (_, attempt) =>
		attempt > 1
			? APIError.generate(
					400,
					{
						error: {
							type: "invalid_request_error",
							message: "Thread lost",
							details: { error_code: "thread_not_found" },
						},
					},
					undefined,
					new Headers(),
				)
			: undefined,
	);
	const state = new Map<string, ProviderSessionState>();
	const options = { apiKey: "test", messageThreads: true, sessionId: "stale-repeat", providerSessionState: state };
	const context = structuredClone(initial);
	const first = await streamAnthropic(model, context, options).result();
	context.messages.push(first, { role: "user", content: "next", timestamp: 2 });
	const result = await streamAnthropic(model, context, options).result();
	expect(result.stopReason).toBe("error");
	expect(bodies.map(b => b.thread.type)).toEqual(["create", "continue", "create"]);
});
it("defines a replaced tool at its conversation position instead of overwriting the initial definition", async () => {
	const bodies = install();
	const old = { name: "counter", description: "old", parameters: { type: "object", properties: {} } };
	const changed = { ...old, description: "new" };
	await streamAnthropic(
		model,
		{
			tools: [old] as any,
			messages: [
				...initial.messages,
				{ role: "developer", content: "", toolsAdded: [changed] as any, timestamp: 2 },
			],
		},
		{ apiKey: "test" },
	).result();
	expect(bodies[0].tools[0].description).toBe("old");
	expect(bodies[0].messages[1].content[0]).toMatchObject({
		type: "tool_addition",
		tool: { type: "tool_definition", definition: { name: "counter", description: "new" } },
	});
});
it("encodes explicit developer effort without changing prior message settings", async () => {
	const bodies = install();
	await streamAnthropic(
		model,
		{ messages: [...initial.messages, { role: "developer", content: "", effort: "low", timestamp: 2 } as any] },
		{ apiKey: "test" },
	).result();
	expect(bodies[0].messages[1]).toMatchObject({ role: "system", output_config: { effort: "low" } });
});

it("keeps a developer instruction in place when the next turn is a user prompt", async () => {
	const bodies = install();
	await streamAnthropic(
		model,
		{
			messages: [
				{ role: "developer", content: "First instruction", timestamp: 1 },
				{ role: "user", content: "Second prompt", timestamp: 2 },
			],
		},
		{ apiKey: "test" },
	).result();
	expect(bodies[0].messages.map((m: any) => m.role)).toEqual(["user", "user"]);
	expect(bodies[0].messages[0].content[0].text).toBe("First instruction");
});

it("sends the requested one-hour cache lifetime through a gateway instead of silently shortening it", async () => {
	const bodies = install();
	await streamAnthropic({ ...model, baseUrl: "https://gateway.example/anthropic" }, initial, {
		apiKey: "test",
		cacheRetention: "long",
	}).result();
	expect(bodies[0].messages[0].content[0].cache_control.ttl).toBe("1h");
});

it("prices each fallback sampling at its own context tier", () => {
	const usage = empty();
	const priced = {
		...model,
		cost: {
			...model.cost,
			tiers: [{ inputTokensAbove: 100, input: 6, output: 30, cacheRead: 0.6, cacheWrite: 7.5 }],
		},
	};
	applyAnthropicIterationUsage(
		{
			iterations: [
				{ type: "message", model: model.id, input_tokens: 120, output_tokens: 2 },
				{ type: "fallback_message", model: "small", input_tokens: 50, output_tokens: 1 },
			],
		},
		usage,
		priced,
		[{ model: "small", cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } }],
	);
	expect(usage.cost.input).toBeCloseTo((120 * 6 + 50 * 0.1) / 1e6, 10);
	expect(usage.cost.output).toBeCloseTo((2 * 30 + 5) / 1e6, 10);
});

it("adds the inline-tools beta for by-value tool redefinitions", async () => {
	vi.restoreAllMocks();
	let headers = new Headers();
	const old = { name: "lookup", description: "old", parameters: { type: "object", properties: {} } };
	await streamAnthropic(
		model,
		{
			tools: [old] as any,
			messages: [
				...initial.messages,
				{ role: "developer", content: "", toolsAdded: [{ ...old, description: "new" }] as any, timestamp: 2 },
			],
		},
		{
			apiKey: "test",
			fetch: async (_input, init) => {
				headers = new Headers(init?.headers);
				return new Response(
					"event: message_start\ndata: " +
						JSON.stringify({
							type: "message_start",
							message: { id: "msg_beta", model: model.id, usage: { input_tokens: 1, output_tokens: 0 } },
						}) +
						"\n\nevent: message_delta\ndata: " +
						JSON.stringify({
							type: "message_delta",
							delta: { stop_reason: "end_turn" },
							usage: { output_tokens: 0 },
						}) +
						'\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
					{ headers: { "content-type": "text/event-stream" } },
				);
			},
		},
	).result();
	expect(headers.get("anthropic-beta")).toContain("inline-tools-2026-09-15");
});
