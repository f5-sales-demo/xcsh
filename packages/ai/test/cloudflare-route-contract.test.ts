import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getBundledModel } from "../src/models";
import { classify, getBundledClassifierModels } from "../src/operations";
import {
	cloudflareAiGatewayModelManagerOptions,
	MODELS_DEV_PROVIDER_DESCRIPTORS,
	mapModelsDevToModels,
} from "../src/provider-models/openai-compat";
import { streamAnthropic } from "../src/providers/anthropic";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import type { Model } from "../src/types";

describe("Cloudflare gateway transport", () => {
	it("resolves the bundled Workers classifier account before requesting its REST operation", async () => {
		let url = "";
		const model = getBundledClassifierModels("cloudflare-workers-ai")[0]!;
		const result = await classify(
			model,
			{
				state: { synthetic: true },
				questions: {
					safe: { type: "bool", instructions: "Synthetic?", criteria: { true: "Synthetic", false: "Real" } },
				},
			},
			{
				apiKey: "synthetic",
				accountId: "123456789012",
				fetch: async input => {
					url = String(input);
					return Response.json({
						success: true,
						result: { state: "Completed", result: { answers: { safe: { type: "noul", noul: 0.9 } } } },
					});
				},
			},
		);
		expect(result.stopReason).toBe("stop");
		expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/123456789012/ai/run");
	});
	it("mirrors missing Workers entries while preserving existing Gateway metadata", () => {
		const native = {
			name: "Synthetic Worker",
			tool_call: true,
			reasoning: true,
			modalities: { input: ["text", "image"] },
			limit: { context: 64000, output: 2000 },
			cost: { input: 1, output: 2, cache_read: 0.1 },
			reasoning_options: [{ type: "effort" as const, values: ["high"] }],
		};
		const models = mapModelsDevToModels(
			{
				"cloudflare-workers-ai": {
					models: { "@cf/example": native, "@cf/unsupported": { ...native, tool_call: false } },
				},
				"cloudflare-ai-gateway": {
					models: {
						"workers-ai/@cf/existing": { ...native, name: "Gateway override" },
						"anthropic/claude-synthetic": native,
						"openai/gpt-synthetic": native,
					},
				},
			},
			MODELS_DEV_PROVIDER_DESCRIPTORS,
		);
		const gateway = models.filter(model => model.provider === "cloudflare-ai-gateway");
		expect(gateway.find(model => model.id === "workers-ai/@cf/example")).toMatchObject({
			name: native.name,
			api: "openai-completions",
			input: ["text", "image"],
			contextWindow: 64000,
			maxTokens: 2000,
			cost: { input: 1, output: 2, cacheRead: 0.1 },
			compat: { sendSessionAffinityHeaders: true },
			thinking: { supportedLevels: [{ effort: "high" }] },
		});
		expect(gateway.some(model => model.id.includes("unsupported"))).toBe(false);
		expect(gateway.find(model => model.id === "claude-synthetic")?.compat?.sendSessionAffinityHeaders).toBe(true);
		expect(gateway.find(model => model.id === "gpt-synthetic")?.api).toBe("openai-responses");
		const repeated = mapModelsDevToModels(
			{
				"cloudflare-workers-ai": { models: { "@cf/existing": native } },
				"cloudflare-ai-gateway": { models: { "workers-ai/@cf/existing": { ...native, name: "Gateway override" } } },
			},
			MODELS_DEV_PROVIDER_DESCRIPTORS,
		).filter(model => model.provider === "cloudflare-ai-gateway");
		expect(repeated).toHaveLength(1);
		expect(repeated[0]?.name).toBe("Gateway override");
	});
	it("enriches runtime Gateway discovery with each native transport and gateway auth", async () => {
		let url = "";
		let headers = new Headers();
		using _hook = hookFetch(async (input, init) => {
			url = String(input);
			headers = new Headers(init?.headers);
			return Response.json({
				data: [
					{ id: "workers-ai/@cf/synthetic", display_name: "Synthetic" },
					{ id: "openai/gpt-synthetic" },
					{ id: "anthropic/claude-synthetic" },
				],
			});
		});
		const options = cloudflareAiGatewayModelManagerOptions({
			apiKey: "synthetic",
			baseUrl: "https://gateway.ai.cloudflare.com/v1/example-account/example-gateway/anthropic",
		});
		const models = await options.fetchDynamicModels?.();
		expect(url).toContain("example-account/example-gateway");
		expect(headers.get("cf-aig-authorization")).toBe("Bearer synthetic");
		expect(headers.has("x-api-key")).toBe(false);
		expect(
			[...(models ?? [])].sort(
				(a, b) =>
					["workers-ai/@cf/synthetic", "gpt-synthetic", "claude-synthetic"].indexOf(a.id) -
					["workers-ai/@cf/synthetic", "gpt-synthetic", "claude-synthetic"].indexOf(b.id),
			),
		).toMatchObject([
			{
				id: "workers-ai/@cf/synthetic",
				api: "openai-completions",
				baseUrl: "https://gateway.ai.cloudflare.com/v1/example-account/example-gateway/compat",
				compat: { sendSessionAffinityHeaders: true },
			},
			{
				id: "gpt-synthetic",
				api: "openai-responses",
				baseUrl: "https://gateway.ai.cloudflare.com/v1/example-account/example-gateway/openai",
			},
			{
				id: "claude-synthetic",
				api: "anthropic-messages",
				baseUrl: "https://gateway.ai.cloudflare.com/v1/example-account/example-gateway/anthropic",
				compat: { sendSessionAffinityHeaders: true },
			},
		]);
	});
	it("resolves the Responses route and uses gateway auth only", async () => {
		let url = "";
		let headers = new Headers();
		using _hook = hookFetch(async (input, init) => {
			url = String(input);
			headers = new Headers(init?.headers);
			return new Response('data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n', {
				headers: { "Content-Type": "text/event-stream" },
			});
		});
		const model = {
			...getBundledModel("openai", "gpt-6.1-sol"),
			provider: "cloudflare-ai-gateway",
			baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai/v1",
		} as Model<"openai-responses">;
		const result = await streamOpenAIResponses(
			model,
			{ messages: [] },
			{ apiKey: "synthetic", accountId: "example-account", gatewayId: "example-gateway" },
		).result();
		expect(result.stopReason).toBe("stop");
		expect(url).toContain("/example-account/example-gateway/openai/v1/responses");
		expect(headers.get("cf-aig-authorization")).toBe("Bearer synthetic");
		expect(headers.has("authorization")).toBe(false);
	});
	it("resolves Anthropic gateway endpoints without upstream auth headers", async () => {
		let url = "";
		let headers = new Headers();
		using _hook = hookFetch(async (input, init) => {
			url = String(input);
			headers = new Headers(init?.headers);
			return new Response(
				'event: message_start\ndata: {"type":"message_start","message":{"id":"synthetic","usage":{}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
				{ headers: { "Content-Type": "text/event-stream" } },
			);
		});
		const model = {
			...getBundledModel("anthropic", "claude-sonnet-5"),
			provider: "cloudflare-ai-gateway",
			baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
		} as Model<"anthropic-messages">;
		const result = await streamAnthropic(
			model,
			{ messages: [] },
			{ apiKey: "synthetic", accountId: "example-account", gatewayId: "example-gateway" },
		).result();
		expect(result.stopReason).toBe("stop");
		expect(url).toContain("/example-account/example-gateway/anthropic/v1/messages");
		expect(headers.get("cf-aig-authorization")).toBe("Bearer synthetic");
		expect(headers.has("authorization")).toBe(false);
		expect(headers.has("x-api-key")).toBe(false);
	});
});
