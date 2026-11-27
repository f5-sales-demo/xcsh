import { afterEach, describe, expect, it, vi } from "bun:test";
import { anthropicModelManagerOptions } from "../src/provider-models/openai-compat";

const originalFetch = global.fetch;

afterEach(() => {
	global.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("Anthropic authenticated model discovery", () => {
	it("uses service limits and effort capabilities instead of broader bundled defaults", async () => {
		global.fetch = vi.fn(async (input: string | URL | Request) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (url === "https://models.dev/api.json") return Response.json({});
			return Response.json({
				data: [
					{
						id: "claude-sonnet-5-5",
						display_name: "Sonnet current",
						max_input_tokens: 65536,
						max_tokens: 8192,
						capabilities: {
							thinking: {
								supported: true,
								types: {
									adaptive: { supported: true },
									disabled: { supported: true },
									enabled: { supported: false },
								},
							},
							effort: {
								supported: true,
								low: { supported: true },
								medium: { supported: true },
								high: { supported: true },
								xhigh: { supported: false },
								max: { supported: false },
							},
						},
					},
				],
			});
		}) as unknown as typeof fetch;
		const models = await anthropicModelManagerOptions({
			apiKey: "synthetic",
			baseUrl: "https://api.anthropic.com",
		}).fetchDynamicModels?.();
		expect(models?.[0].contextWindow).toBe(65536);
		expect(models?.[0].maxTokens).toBe(8192);
		expect(models?.[0].thinking?.supportedLevels.map(level => level.effort)).toEqual([
			"none",
			"low",
			"medium",
			"high",
		]);
	});
	it("uses a separate gateway catalog while retaining the Anthropic inference route", async () => {
		const requested: string[] = [];
		global.fetch = vi.fn(async (input: string | URL | Request) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			requested.push(url);
			if (url === "https://models.dev/api.json") return Response.json({});
			return Response.json({ data: [{ id: "claude-haiku-5-5" }, { id: "gpt-6.1-sol" }] });
		}) as unknown as typeof fetch;
		const options = anthropicModelManagerOptions({
			apiKey: "gateway-test",
			baseUrl: "https://gateway.example/anthropic",
			discoveryBaseUrl: "https://gateway.example/openai/v1",
		} as any);
		const models = await options.fetchDynamicModels?.();
		expect(requested).toContain("https://gateway.example/openai/v1/models");
		expect(models?.map(model => model.id)).toEqual(["claude-haiku-5-5"]);
		expect(models?.[0].baseUrl).toBe("https://gateway.example/anthropic");
	});
	it("queries the versioned inventory endpoint with OAuth headers and preserves inference base URL", async () => {
		const requested: Array<{ url: string; headers: Headers }> = [];
		global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			requested.push({ url, headers: new Headers(init?.headers) });
			if (url === "https://models.dev/api.json") {
				return Response.json({
					anthropic: {
						models: {
							"claude-sonnet-5": {
								name: "Claude Sonnet 5",
								tool_call: true,
								reasoning: true,
								limit: { context: 1_000_000, output: 128_000 },
							},
						},
					},
				});
			}
			return Response.json({ data: [{ id: "claude-sonnet-5", display_name: "Claude Sonnet 5" }] });
		}) as unknown as typeof fetch;

		const options = anthropicModelManagerOptions({
			apiKey: "sk-ant-oat-test",
			baseUrl: "https://api.anthropic.com",
		});
		const models = await options.fetchDynamicModels?.();

		expect(requested.some(request => request.url === "https://api.anthropic.com/v1/models")).toBe(true);
		const inventory = requested.find(request => request.url.endsWith("/v1/models"));
		expect(inventory?.headers.get("authorization")).toBe("Bearer sk-ant-oat-test");
		expect(inventory?.headers.get("anthropic-beta")).toContain("oauth-2025-04-20");
		expect(models?.[0]).toMatchObject({
			provider: "anthropic",
			id: "claude-sonnet-5",
			baseUrl: "https://api.anthropic.com",
		});
	});
});
