import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getBundledModel } from "../src/models";
import { streamAnthropic } from "../src/providers/anthropic";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import type { Model } from "../src/types";

describe("Cloudflare gateway transport", () => {
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
