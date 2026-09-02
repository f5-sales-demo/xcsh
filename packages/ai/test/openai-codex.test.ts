import { describe, expect, it } from "bun:test";
import { Effort, enrichModelThinking } from "@f5-sales-demo/pi-ai/model-thinking";
import {
	type RequestBody,
	transformRequestBody,
} from "@f5-sales-demo/pi-ai/providers/openai-codex/request-transformer";
import { parseCodexError } from "@f5-sales-demo/pi-ai/providers/openai-codex/response-handler";
import { mapOptionsForApi } from "@f5-sales-demo/pi-ai/stream";
import type { Model } from "@f5-sales-demo/pi-ai/types";

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

describe("openai-codex request transformer", () => {
	it("preserves explicit none and max through generic stream option mapping", () => {
		const model = createCodexModel("gpt-5.6-sol");
		const mappedNone = mapOptionsForApi(model, { reasoning: "none" as never }) as unknown as { reasoning?: string };
		const mappedMax = mapOptionsForApi(model, { reasoning: Effort.Max }) as unknown as { reasoning?: string };
		expect(mappedNone.reasoning).toBe("none");
		expect(mappedMax.reasoning).toBe("max");
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
});

describe("openai-codex reasoning effort validation", () => {
	it("sends explicit none, preserves max, and omits inherited effort", async () => {
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

		expect(inherited.reasoning).toBeUndefined();
		expect(none.reasoning).toEqual({ effort: "none", summary: "detailed" });
		expect(max.reasoning).toEqual({ effort: "max", summary: "detailed" });
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
