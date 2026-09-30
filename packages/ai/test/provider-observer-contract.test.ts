import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getBundledModel } from "../src/models";
import { streamGoogle } from "../src/providers/google";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import type { Model } from "../src/types";

describe("provider request observers", () => {
	it("awaits the Responses response callback before consuming events", async () => {
		const seen: string[] = [];
		using _hook = hookFetch(
			async () =>
				new Response('data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n', {
					headers: { "Content-Type": "text/event-stream" },
				}),
		);
		const result = await streamOpenAIResponses(
			getBundledModel("openai", "gpt-6.1-sol") as Model<"openai-responses">,
			{ messages: [] },
			{
				apiKey: "synthetic",
				onResponse: async () => {
					await Promise.resolve();
					seen.push("response");
				},
				onProviderStreamEvent: async () => {
					seen.push("event");
				},
			},
		).result();
		expect(result.stopReason).toBe("stop");
		expect(seen).toEqual(["response", "event"]);
	});
	it("awaits Google replacement hooks and preserves raw event observation", async () => {
		let payload: any;
		let events = 0;
		using _hook = hookFetch(async (_input, init) => {
			payload = JSON.parse(String(init?.body));
			return new Response(
				'data: {"candidates":[{"content":{"parts":[{"text":"synthetic"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2,"thoughtsTokenCount":3,"totalTokenCount":15}}\n\n',
				{ headers: { "Content-Type": "text/event-stream" } },
			);
		});
		const model = {
			...getBundledModel("google", "gemini-2.5-flash"),
			api: "google-generative-ai",
		} as Model<"google-generative-ai">;
		const result = await streamGoogle(
			model,
			{ messages: [{ role: "user", content: "synthetic", timestamp: 0 }] },
			{
				apiKey: "synthetic",
				onPayload: async value => {
					await Promise.resolve();
					return { ...(value as object), contents: [{ role: "user", parts: [{ text: "replacement" }] }] };
				},
				onProviderStreamEvent: async () => {
					events++;
				},
			},
		).result();
		expect(result.stopReason).toBe("stop");
		expect(JSON.stringify(payload)).toContain("replacement");
		expect(events).toBe(1);
		expect(result.usage).toMatchObject({ output: 5, reasoningTokens: 3 });
	});
});
