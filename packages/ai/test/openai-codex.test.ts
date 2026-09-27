import { describe, expect, it } from "bun:test";
import { Effort, enrichModelThinking } from "@f5-sales-demo/pi-ai/model-thinking";
import {
	type RequestBody,
	transformRequestBody,
} from "@f5-sales-demo/pi-ai/providers/openai-codex/request-transformer";
import { parseCodexError } from "@f5-sales-demo/pi-ai/providers/openai-codex/response-handler";
import { streamOpenAIResponses } from "@f5-sales-demo/pi-ai/providers/openai-responses";
import { mapOptionsForApi } from "@f5-sales-demo/pi-ai/stream";
import type { Context, Model } from "@f5-sales-demo/pi-ai/types";
import { Type } from "@sinclair/typebox";
import { applyCodexInteractionMetadata } from "../src/codex-model-interaction";
import { getBundledModel } from "../src/models";

const DEFAULT_PROMPT_PREFIX =
	"You are an expert coding assistant. You help users with coding tasks by reading files, executing commands";

function createCodexModel(id: string): Model<"openai-codex-responses"> {
	return enrichModelThinking({
		id,
		name: id,
		api: "openai-codex-responses",
		provider: "openai-codex",
		baseUrl: "https://api.openai.com/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 272000,
		maxTokens: 128000,
	});
}

async function captureLiteLLMPayload(
	model: Model<"openai-responses">,
	reasoningSummary?: "none" | "auto" | "concise" | "detailed",
): Promise<Record<string, unknown>> {
	const controller = new AbortController();
	controller.abort();
	const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
	streamOpenAIResponses(
		model,
		{ messages: [{ role: "user", content: "hello", timestamp: 1 }] },
		{
			apiKey: "test-key",
			reasoningSummary,
			signal: controller.signal,
			onPayload: payload => resolve(payload as Record<string, unknown>),
		},
	);
	return promise;
}

describe("openai-codex request transformer", () => {
	// Differential contract pinned to openai/codex@985cf47a4eb6084b2ff6b30ebdb1216acda85bb4:
	// codex-rs/core/src/client.rs and codex-rs/codex-api/src/common.rs.
	it("matches the normalized pinned Codex Responses request contract", async () => {
		const model = applyCodexInteractionMetadata(createCodexModel("gpt-6-sol"));
		const transformed = await transformRequestBody(
			{
				model: model.id,
				instructions: "system",
				input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
				tools: [{ type: "function", name: "probe", description: "probe", parameters: {} }],
				tool_choice: "required",
				prompt_cache_key: "stable-session",
				max_output_tokens: 32_000,
			},
			model,
			{ metadata: { source: "xcsh", attempt: 1 } },
		);

		expect(transformed).toEqual({
			model: "gpt-6-sol",
			instructions: "system",
			input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
			tools: [{ type: "function", name: "probe", description: "probe", parameters: {} }],
			tool_choice: "auto",
			parallel_tool_calls: true,
			reasoning: { effort: "medium" },
			store: false,
			stream: true,
			include: ["reasoning.encrypted_content"],
			service_tier: "priority",
			prompt_cache_key: "stable-session",
			text: { verbosity: "low" },
			client_metadata: { source: "xcsh", attempt: "1" },
		});
	});

	it("keeps LiteLLM and pinned Codex interaction payloads equivalent", async () => {
		const codexModel = applyCodexInteractionMetadata(createCodexModel("gpt-6-sol"));
		const liteLLMModel = {
			...codexModel,
			api: "openai-responses" as const,
			provider: "litellm",
			baseUrl: "https://proxy.example.com/openai/v1",
		};
		const context: Context = {
			messages: [{ role: "user", content: "hello", timestamp: 1 }],
			tools: [{ name: "probe", description: "probe", parameters: Type.Object({}) }],
		};
		const controller = new AbortController();
		controller.abort();
		const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
		streamOpenAIResponses(liteLLMModel, context, {
			apiKey: "test-key",
			reasoning: "high",
			toolChoice: "required",
			sessionId: "stable-session",
			metadata: { source: "xcsh", attempt: 1 },
			signal: controller.signal,
			onPayload: payload => resolve(payload as Record<string, unknown>),
		});

		const codexPayload = await transformRequestBody(
			{
				model: codexModel.id,
				input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
				tools: [
					{
						type: "function",
						name: "probe",
						description: "probe",
						parameters: { type: "object", properties: {} },
					},
				],
				prompt_cache_key: "stable-session",
			},
			codexModel,
			{ reasoningEffort: "high", metadata: { source: "xcsh", attempt: 1 } },
		);
		const liteLLMPayload = await promise;
		const interactionKeys = [
			"model",
			"input",
			"tools",
			"tool_choice",
			"parallel_tool_calls",
			"reasoning",
			"text",
			"store",
			"stream",
			"include",
			"service_tier",
			"prompt_cache_key",
			"client_metadata",
		] as const;
		const normalize = (payload: Record<string, unknown>) =>
			JSON.parse(JSON.stringify(Object.fromEntries(interactionKeys.map(key => [key, payload[key]]))));

		expect(normalize(liteLLMPayload)).toEqual(normalize(codexPayload));
	});

	it("lets explicit none override a LiteLLM catalog summary", async () => {
		const codexModel = applyCodexInteractionMetadata(createCodexModel("gpt-5.6-terra"));
		const liteLLMModel: Model<"openai-responses"> = {
			...codexModel,
			api: "openai-responses",
			provider: "litellm",
			baseUrl: "https://proxy.example.com/openai/v1",
			defaultReasoningSummary: "detailed",
		};

		const payload = await captureLiteLLMPayload(liteLLMModel, "none");
		expect(payload.reasoning).toEqual({ effort: "medium" });
	});

	it.each(["auto", "concise", "detailed"] as const)(
		"serializes the %s reasoning summary through LiteLLM Responses",
		async summary => {
			const codexModel = applyCodexInteractionMetadata(createCodexModel("gpt-5.6-terra"));
			const liteLLMModel: Model<"openai-responses"> = {
				...codexModel,
				api: "openai-responses",
				provider: "litellm",
				baseUrl: "https://proxy.example.com/openai/v1",
			};

			const payload = await captureLiteLLMPayload(liteLLMModel, summary);
			expect(payload.reasoning).toEqual({ effort: "medium", summary });
		},
	);

	it.each(["gpt-6-luna", "gpt-6-sol"])("preserves tools, developer messages, and max effort for %s", async id => {
		const model = getBundledModel("openai-codex", id) as Model<"openai-codex-responses">;
		const transformed = await transformRequestBody(
			{
				model: id,
				input: [{ type: "message", role: "developer", content: [{ type: "input_text", text: "system" }] }],
				tools: [{ type: "function", name: "probe", description: "probe", parameters: {} }],
			},
			model,
			{ reasoningEffort: "max" },
		);
		expect(transformed.input?.[0]).toMatchObject({ type: "message", role: "developer" });
		expect(transformed.tools).toEqual([{ type: "function", name: "probe", description: "probe", parameters: {} }]);
		expect(transformed.reasoning).toEqual({ effort: "max" });
		expect(transformed.text).toEqual({ verbosity: "low" });
		expect(transformed.tool_choice).toBe("auto");
		expect(transformed.parallel_tool_calls).toBe(true);
	});

	it("preserves explicit none and max through generic stream option mapping", () => {
		const model = createCodexModel("gpt-5.6-sol");
		const mappedNone = mapOptionsForApi(model, { reasoning: "none" as never }) as unknown as { reasoning?: string };
		const mappedMax = mapOptionsForApi(model, { reasoning: Effort.Max }) as unknown as { reasoning?: string };
		expect(mappedNone.reasoning).toBe("none");
		expect(mappedMax.reasoning).toBe("max");
	});

	it("maps Ultra to the pinned model wire effort", async () => {
		const model = applyCodexInteractionMetadata(createCodexModel("gpt-6-astra"));
		const transformed = await transformRequestBody({ model: "gpt-6-astra", input: [] }, model, {
			reasoningEffort: "ultra",
		});
		expect(transformed.reasoning).toEqual({ effort: "xhigh" });
	});

	it("removes sampling controls rejected by the Codex backend", async () => {
		const body: RequestBody = {
			model: "gpt-5.6-terra",
			input: [],
			temperature: 0.7,
			top_p: 0.9,
			top_k: 40,
			min_p: 0.05,
			presence_penalty: 0.2,
			repetition_penalty: 1.1,
		};

		const transformed = await transformRequestBody(body, createCodexModel(body.model), {});

		expect(transformed.temperature).toBeUndefined();
		expect(transformed.top_p).toBeUndefined();
		expect(transformed.top_k).toBeUndefined();
		expect(transformed.min_p).toBeUndefined();
		expect(transformed.presence_penalty).toBeUndefined();
		expect(transformed.repetition_penalty).toBeUndefined();
	});

	it("filters item_reference and strips ids", async () => {
		const body: RequestBody = {
			model: "gpt-5.1-codex",
			input: [
				{
					type: "message",
					role: "developer",
					id: "sys-1",
					content: [{ type: "input_text", text: `${DEFAULT_PROMPT_PREFIX}...` }],
				},
				{
					type: "message",
					role: "user",
					id: "user-1",
					content: [{ type: "input_text", text: "hello" }],
				},
				{ type: "item_reference", id: "ref-1" },
				{ type: "function_call_output", call_id: "missing", name: "tool", output: "result" },
			],
			tools: [{ type: "function", name: "tool", description: "", parameters: {} }],
		};

		const transformed = await transformRequestBody(body, createCodexModel(body.model), {});

		expect(transformed.store).toBe(false);
		expect(transformed.stream).toBe(true);
		expect(transformed.include).toEqual(["reasoning.encrypted_content"]);

		const input = transformed.input || [];
		expect(input.some(item => item.type === "item_reference")).toBe(false);
		expect(input.some(item => "id" in item)).toBe(false);
		const first = input[0];
		expect(first?.type).toBe("message");
		expect(first?.role).toBe("developer");
		expect(first?.content).toEqual([{ type: "input_text", text: `${DEFAULT_PROMPT_PREFIX}...` }]);

		const orphaned = input.find(item => item.type === "message" && item.role === "assistant");
		expect(orphaned?.content).toMatch(/Previous tool result/);
	});

	it("applies the model token policy with Codex middle truncation to tool output", async () => {
		const model = {
			...(getBundledModel("openai-codex", "gpt-6-sol") as Model<"openai-codex-responses">),
			truncationPolicy: { mode: "tokens" as const, limit: 10 },
		};
		const transformed = await transformRequestBody(
			{
				model: model.id,
				input: [
					{ type: "function_call", call_id: "call_1", name: "probe", arguments: "{}" },
					{ type: "function_call_output", call_id: "call_1", output: "a".repeat(60) },
				],
			},
			model,
		);

		expect(transformed.input?.[1]?.output).toBe(`${"a".repeat(20)}…5 tokens truncated…${"a".repeat(20)}`);
	});

	it("uses model service defaults and normalizes client metadata", async () => {
		const model = applyCodexInteractionMetadata(createCodexModel("gpt-6-sol"));
		const transformed = await transformRequestBody({ model: model.id, input: [] }, model, {
			metadata: { origin: "xcsh", attempt: 2, resumed: true, ignored: { secret: "value" } },
		});

		expect(transformed.service_tier).toBe("priority");
		expect(transformed.client_metadata).toEqual({ origin: "xcsh", attempt: "2", resumed: "true" });
	});

	it("rejects a service tier absent from exact model metadata", async () => {
		const model = applyCodexInteractionMetadata(createCodexModel("gpt-6-astra"));
		await expect(transformRequestBody({ model: model.id, input: [], service_tier: "flex" }, model)).rejects.toThrow(
			/Service tier "flex" is unavailable/,
		);
	});
});

describe("openai-codex reasoning effort validation", () => {
	it("omits semantic none while preserving reasoning effort", async () => {
		const model = createCodexModel("gpt-5.6-sol");
		model.thinking = {
			mode: "effort",
			defaultLevel: "medium",
			supportedLevels: [
				{ effort: "none", description: "No reasoning" },
				{ effort: "medium", description: "Balanced reasoning" },
				{ effort: "max", description: "Maximum reasoning" },
			],
		};

		const inherited = await transformRequestBody({ model: model.id, input: [] }, model, {});
		const none = await transformRequestBody({ model: model.id, input: [] }, model, { reasoningEffort: "none" });
		const max = await transformRequestBody({ model: model.id, input: [] }, model, { reasoningEffort: "max" });

		expect(inherited.reasoning).toEqual({ effort: "medium" });
		expect(none.reasoning).toEqual({ effort: "none" });
		expect(max.reasoning).toEqual({ effort: "max" });
	});

	it("lets explicit none remove an existing or catalog-provided summary", async () => {
		const model = createCodexModel("gpt-5.6-terra");
		model.defaultReasoningSummary = "detailed";
		const transformed = await transformRequestBody(
			{ model: model.id, input: [], reasoning: { effort: "medium", summary: "auto" } },
			model,
			{ reasoningSummary: "none" },
		);

		expect(transformed.reasoning).toEqual({ effort: "medium" });
	});

	it.each(["auto", "concise", "detailed"] as const)("serializes the %s reasoning summary", async summary => {
		const model = createCodexModel("gpt-5.6-terra");
		const transformed = await transformRequestBody({ model: model.id, input: [] }, model, {
			reasoningSummary: summary,
		});

		expect(transformed.reasoning).toEqual({ effort: "medium", summary });
	});

	it("rejects gpt-5.1 xhigh when metadata does not list it", async () => {
		const body: RequestBody = { model: "gpt-5.1", input: [] };
		await expect(
			transformRequestBody(body, createCodexModel(body.model), { reasoningEffort: "xhigh" }),
		).rejects.toThrow(/Supported efforts: minimal, low, medium, high/);
	});

	it("rejects unsupported Codex mini efforts instead of clamping", async () => {
		const body: RequestBody = { model: "gpt-5.1-codex-mini", input: [] };

		await expect(
			transformRequestBody({ ...body }, createCodexModel(body.model), { reasoningEffort: "low" }),
		).rejects.toThrow(/Supported efforts: medium, high/);

		await expect(
			transformRequestBody({ ...body }, createCodexModel(body.model), { reasoningEffort: "xhigh" }),
		).rejects.toThrow(/Supported efforts: medium, high/);
	});
});

describe("openai-codex error parsing", () => {
	it("produces friendly usage-limit messages and rate limits", async () => {
		const resetAt = Math.floor(Date.now() / 1000) + 600;
		const response = new Response(
			JSON.stringify({
				error: { code: "usage_limit_reached", plan_type: "Plus", resets_at: resetAt },
			}),
			{
				status: 429,
				headers: {
					"x-codex-primary-used-percent": "99",
					"x-codex-primary-window-minutes": "60",
					"x-codex-primary-reset-at": String(resetAt),
				},
			},
		);

		const info = await parseCodexError(response);
		expect(info.friendlyMessage?.toLowerCase()).toContain("usage limit");
		expect(info.rateLimits?.primary?.used_percent).toBe(99);
	});
});
