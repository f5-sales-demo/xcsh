import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { getBundledModels } from "../src/models";
import { classify, generateImages, getBundledClassifierModels, getBundledImageModels } from "../src/operations";
import { stream, streamSimple } from "../src/stream";
import type { Api, Model } from "../src/types";
import fixtures from "./evidence/pinned-provider-contracts-4611.json";

const sse = (items: unknown[]) =>
	new Response(
		items
			.map(
				item =>
					`${(typeof item === "object" && item && "type" in item && String(item.type).startsWith("message")) || (typeof item === "object" && item && "type" in item && String(item.type).startsWith("content_block")) ? `event: ${(item as { type: string }).type}\n` : ""}data: ${typeof item === "string" ? item : JSON.stringify(item)}\n\n`,
			)
			.join(""),
		{
			headers: { "Content-Type": "text/event-stream" },
		},
	);
function reply(api: string) {
	if (api === "anthropic-messages")
		return sse([
			{ type: "message_start", message: { id: "synthetic", usage: { input_tokens: 10 } } },
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "SYNTHETIC_OK" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
			{ type: "message_stop" },
		]);
	if (api === "openai-responses" || api === "azure-openai-responses")
		return sse([
			{
				type: "response.output_item.added",
				output_index: 0,
				item: { type: "message", id: "msg_synthetic", role: "assistant", content: [] },
			},
			{
				type: "response.content_part.added",
				output_index: 0,
				content_index: 0,
				part: { type: "output_text", text: "" },
			},
			{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "SYNTHETIC_OK" },
			{
				type: "response.completed",
				response: {
					id: "resp_synthetic",
					status: "completed",
					output: [],
					usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
				},
			},
		]);
	if (api === "google-generative-ai")
		return sse([
			{
				candidates: [{ content: { parts: [{ text: "SYNTHETIC_OK" }] }, finishReason: "STOP" }],
				usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1, totalTokenCount: 11 },
			},
		]);
	if (api === "pi-messages")
		return sse([
			{ type: "start" },
			{ type: "text_start", contentIndex: 0 },
			{ type: "text_delta", contentIndex: 0, delta: "SYNTHETIC_OK" },
			{ type: "text_end", contentIndex: 0, content: "SYNTHETIC_OK" },
			{
				type: "done",
				reason: "stop",
				usage: {
					input: 10,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 11,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
		]);
	return sse([
		{
			id: "synthetic",
			choices: [{ index: 0, delta: { content: "SYNTHETIC_OK" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
		},
		"[DONE]",
	]);
}

describe("pinned provider operation qualification", () => {
	it("preserves explicit OpenCode session headers through simple dispatch", async () => {
		let headers = new Headers();
		using _hook = hookFetch(async (_input, init) => {
			headers = new Headers(init?.headers);
			return reply("openai-completions");
		});
		const model = getBundledModels("opencode-zen").find(model => model.api === "openai-completions")!;
		expect(
			(
				await streamSimple(
					model,
					{ messages: [] },
					{ apiKey: "synthetic", sessionId: "synthetic-session", headers: { "X-OpenCode-Session": "explicit" } },
				).result()
			).stopReason,
		).toBe("stop");
		expect(headers.get("x-opencode-session")).toBe("explicit");
	});
	for (const fixture of fixtures) {
		// These transports have dedicated SDK/WebSocket fixtures including authentication and replay.
		if (["bedrock-converse-stream", "openai-codex-responses", "google-vertex"].includes(fixture.api)) continue;
		it(`${fixture.upstream}: ${fixture.api} dispatch, authentication, request and result`, async () => {
			const bundled = [
				...getBundledModels(fixture.provider as any),
				...getBundledClassifierModels(fixture.provider),
				...getBundledImageModels(fixture.provider),
			].find(model => model.api === fixture.api && model.id === fixture.modelId);
			const model = {
				...(bundled ?? {
					id: fixture.modelId,
					name: "Synthetic",
					reasoning: false,
					input: ["text"],
					contextWindow: 32000,
					maxTokens: 1000,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				}),
				provider: fixture.provider,
				api: fixture.api,
				baseUrl: fixture.baseUrl
					?.replaceAll("{account}", "123456789012")
					.replaceAll("{CLOUDFLARE_ACCOUNT_ID}", "123456789012")
					.replaceAll("<account>", "123456789012")
					.replaceAll("{CLOUDFLARE_GATEWAY_ID}", "synthetic-gateway")
					.replaceAll("<gateway>", "synthetic-gateway"),
			} as Model<Api>;
			let url = "";
			let payload: any;
			let headers = new Headers();
			using _hook = hookFetch(async (input, init) => {
				url = String(input);
				payload = JSON.parse(String(init?.body));
				headers = new Headers(init?.headers);
				return reply(fixture.api);
			});
			const capture = async (input: any, init: any) => {
				url = String(input);
				payload = JSON.parse(String(init?.body));
				headers = new Headers(init?.headers);
				if (fixture.api === "openrouter-images")
					return Response.json({
						choices: [
							{
								message: {
									content: "Synthetic",
									images: [{ image_url: { url: "data:image/png;base64,aGVsbG8=" } }],
								},
							},
						],
					});
				const answer = {
					answers: { safe: { type: "noul", noul: 0.9 } },
					usage: { input_tokens: 10, output_tokens: 1 },
				};
				if (fixture.api === "cloudflare-workers-ai-system-one")
					return Response.json({ success: true, result: { state: "Completed", result: answer } });
				return Response.json(answer);
			};
			if (fixture.api.endsWith("system-one")) {
				const result = await classify(
					model as any,
					{
						state: { synthetic: true },
						questions: {
							safe: { type: "bool", instructions: "Synthetic?", criteria: { true: "Synthetic", false: "Real" } },
						},
					},
					{ apiKey: "synthetic", fetch: capture },
				);
				expect(result.stopReason).toBe("stop");
				expect(result.answers.safe).toEqual({ type: "bool", probability: 0.9 });
				expect(url).toEndWith(fixture.api.startsWith("cloudflare") ? "/run" : "/systemone");
			} else if (fixture.api === "openrouter-images") {
				const result = await generateImages(
					model as any,
					{ input: [{ type: "text", text: "Synthetic square" }] },
					{ apiKey: "synthetic", fetch: capture },
				);
				expect(result.stopReason).toBe("stop");
				expect(result.output.some(part => part.type === "image")).toBe(true);
				expect(url).toEndWith("/chat/completions");
			} else {
				const result = await stream(
					model,
					{
						messages: [{ role: "user", content: "Synthetic qualification", timestamp: 0 }],
						tools: [
							{ name: "read", description: "Read synthetic", parameters: Type.Object({ path: Type.String() }) },
						],
					},
					{
						apiKey: "synthetic",
						sessionId: "synthetic-session",
						accountId: "123456789012",
						gatewayId: "synthetic-gateway",
						azureDeploymentName: "synthetic-deployment",
					} as any,
				).result();
				expect(result.stopReason).toBe("stop");
				expect(result.provider).toBe(fixture.provider);
				expect(result.content.some(part => part.type === "text" && part.text === "SYNTHETIC_OK")).toBe(true);
				expect(result.usage.output).toBe(1);
				expect(JSON.stringify(payload)).toContain("Synthetic qualification");
				expect(JSON.stringify(payload)).toContain("read");
				if (fixture.api.includes("responses")) expect(new URL(url).pathname).toEndWith("/responses");
				else if (fixture.api === "anthropic-messages" || fixture.api === "pi-messages")
					expect(url).toEndWith("/messages");
				else if (fixture.api !== "google-generative-ai") expect(url).toEndWith("/chat/completions");
				if (fixture.provider.startsWith("opencode"))
					expect(headers.get("x-opencode-session")).toBe("synthetic-session");
			}
			expect(url.startsWith("https://")).toBe(true);
			expect(
				headers.has("authorization") ||
					headers.has("x-api-key") ||
					headers.has("api-key") ||
					headers.has("cf-aig-authorization") ||
					url.includes("key=synthetic") ||
					headers.has("x-goog-api-key"),
			).toBe(true);
			if (fixture.provider === "cloudflare-ai-gateway") {
				expect(headers.get("cf-aig-authorization")).toBe("Bearer synthetic");
				expect(headers.has("authorization")).toBe(false);
			}
		});
	}
});
