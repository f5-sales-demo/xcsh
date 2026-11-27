import { describe, expect, it } from "bun:test";
import { createThinkingConfig, ReasoningEffort } from "../src/model-thinking";
import { type AnthropicOptions, streamAnthropic } from "../src/providers/anthropic";
import { mapOptionsForApi } from "../src/stream";
import type { Model } from "../src/types";

const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-5-5",
	name: "Claude Sonnet 5.5",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	contextWindow: 200_000,
	maxTokens: 8192,
	thinking: createThinkingConfig(
		[ReasoningEffort.Low, ReasoningEffort.Medium, ReasoningEffort.High, ReasoningEffort.XHigh, ReasoningEffort.Max],
		"anthropic-adaptive",
	),
};

async function capture(
	options: Record<string, unknown> | AnthropicOptions,
	selected = model,
	tools?: import("../src/types").Tool[],
) {
	let payload: Record<string, any> | undefined;
	const controller = new AbortController();
	const stream = streamAnthropic(
		selected,
		{ tools, messages: [{ role: "user", content: "Return the number 19.", timestamp: 1 }] },
		{
			apiKey: "test-api-key",
			signal: controller.signal,
			...options,
			onPayload: value => {
				payload = value as Record<string, any>;
				controller.abort();
			},
		} as AnthropicOptions,
	);
	const result = await stream.result();
	return { payload, result };
}

describe("current Anthropic controls", () => {
	it.each(["any", { type: "tool", name: "calculate" }])(
		"rejects unsupported forced tool choice without changing its meaning: %j",
		async toolChoice => {
			const { payload, result } = await capture(
				{ toolChoice },
				{ ...model, compat: { supportsForcedToolChoice: false, requiresThinkingEnabled: true } },
			);
			expect(payload).toBeUndefined();
			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toContain("forced tool choice");
		},
	);
	it("encodes an advertised off preset as disabled thinking", async () => {
		const selected = {
			...model,
			compat: { requiresThinkingEnabled: false },
			thinking: createThinkingConfig(
				[ReasoningEffort.None, ReasoningEffort.Low, ReasoningEffort.Medium],
				"anthropic-adaptive",
			),
		};
		const mapped = mapOptionsForApi(selected, { reasoning: ReasoningEffort.None as any });
		const { payload } = await capture(mapped, selected);
		expect(payload?.thinking).toEqual({ type: "disabled" });
		expect(payload?.output_config?.effort).toBeUndefined();
	});
	it("honors required strict schema sampling with automatic tool choice and eager input", async () => {
		const tools = [
			{
				name: "calculate",
				description: "Calculate",
				parameters: { type: "object", properties: { value: { type: "number" } }, required: ["value"] } as any,
				constrainedSampling: { type: "json_schema", strict: "require" } as const,
			},
		];
		const { payload } = await capture(
			{},
			{ ...model, compat: { supportsStrictTools: true, supportsEagerToolInputStreaming: true } },
			tools,
		);
		expect(payload?.tools[0].strict).toBe(true);
		expect(payload?.tools[0].eager_input_streaming).toBe(true);
	});
	it("rejects required strict tools beyond the total request tool limit", async () => {
		const tools = Array.from({ length: 21 }, (_, i) => ({
			name: `tool_${i}`,
			description: "Fixture",
			parameters: { type: "object", properties: {} } as any,
			constrainedSampling: { type: "json_schema", strict: "require" } as const,
		}));
		const { payload, result } = await capture({}, { ...model, compat: { supportsStrictTools: true } }, tools);
		expect(payload).toBeUndefined();
		expect(result.errorMessage).toContain("strict");
	});
	it("forwards advanced controls and fast service tier through the unified stream API", () => {
		const mapped = mapOptionsForApi(model, {
			thinkingDisplay: "omitted",
			taskBudget: { type: "tokens", total: 5000 },
			serviceTier: "priority",
			messageThreads: true,
		});
		expect(mapped.thinkingDisplay).toBe("omitted");
		expect(mapped.taskBudget).toEqual({ type: "tokens", total: 5000 });
		expect(mapped.serviceTier).toBe("priority");
		expect(mapped.messageThreads).toBe(true);
	});
	it("sends omitted thinking with signed block binding and explicit effort", async () => {
		const { payload } = await capture({
			thinkingEnabled: true,
			thinkingDisplay: "omitted",
			anthropicPrefixMismatchBehavior: "error",
			effort: "xhigh",
		});
		expect(payload?.thinking).toEqual({
			type: "adaptive",
			display: "omitted",
			block_binding: { prefix_mismatch_behavior: "error" },
		});
		expect(payload?.output_config.effort).toBe("xhigh");
	});

	it("retains structured output and task budget when forcing a tool disables thinking", async () => {
		const format = {
			type: "json_schema",
			schema: {
				type: "object",
				properties: { value: { type: "number" } },
				required: ["value"],
				additionalProperties: false,
			},
		};
		const budget = { type: "tokens", total: 12000, remaining: 7000 };
		const { payload } = await capture({
			thinkingEnabled: true,
			effort: "high",
			toolChoice: "any",
			outputFormat: format,
			taskBudget: budget,
		});
		expect(payload?.thinking).toBeUndefined();
		expect(payload?.output_config).toEqual({ format, task_budget: budget });
	});

	it("sends fast mode explicitly without silently selecting a slower mode", async () => {
		const { payload } = await capture({ serviceTier: "priority" });
		expect(payload?.speed).toBe("fast");
	});

	it("preserves context edits and requests signed on-demand compaction", async () => {
		const edits = {
			edits: [
				{
					type: "clear_tool_uses_20250919",
					trigger: { type: "input_tokens", value: 8000 },
					keep: { type: "tool_uses", value: 2 },
				},
			],
		};
		const { payload } = await capture({
			contextManagement: edits,
			anthropicCompaction: { instructions: "Preserve the canary and the calculation." },
			taskBudget: { type: "tokens", total: 12000, remaining: 7000 },
		});
		expect(payload?.context_management).toBeUndefined();
		expect(payload?.compaction).toEqual({
			type: "summarize",
			instructions: "Preserve the canary and the calculation.",
		});
		expect(payload?.output_config.task_budget).toEqual({ type: "tokens", total: 12000 });
	});

	it("sends only the explicitly configured server fallback chain", async () => {
		const { payload } = await capture({ fallbacks: [{ model: "claude-haiku-5-5" }] });
		expect(payload?.fallbacks).toEqual([{ model: "claude-haiku-5-5" }]);
		const normal = await capture({});
		expect(normal.payload?.fallbacks).toBeUndefined();
	});

	it.each([
		{ thinkingDisplay: "bogus" },
		{ anthropicPrefixMismatchBehavior: "bogus" },
		{ thinkingEnabled: true, effort: "minimal" },
		{ taskBudget: { type: "tokens", total: -1 } },
		{ fallbacks: [{ model: "a" }, { model: "b" }, { model: "c" }, { model: "d" }] },
		{ maxTokens: 0 },
	])("rejects invalid controls before submitting a payload: %j", async options => {
		const { payload, result } = await capture(options);
		expect(payload).toBeUndefined();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("Anthropic");
	});

	it("defaults adaptive thinking display to summarized", async () => {
		const { payload } = await capture({ thinkingEnabled: true });
		expect(payload?.thinking.display).toBe("summarized");
	});
});
