import { afterEach, describe, expect, it, vi } from "bun:test";
import { anthropicModelManagerOptions } from "../src/provider-models/openai-compat";

const originalFetch = global.fetch;

afterEach(() => {
	global.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("Anthropic authenticated model discovery", () => {
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
