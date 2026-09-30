import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getBundledModel } from "../src/models";
import { streamOpenAICompletions } from "../src/providers/openai-completions";
import type { Model } from "../src/types";

const model: Model<"openai-completions"> = { ...getBundledModel("openai", "gpt-4o-mini"), api: "openai-completions" };
const sse = (events: unknown[]) =>
	new Response(`${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`, {
		headers: { "Content-Type": "text/event-stream" },
	});
describe("completion streaming lifecycle", () => {
	it("awaits response and raw event observers, then infers tools on routes without finish reasons", async () => {
		const seen: string[] = [];
		using _hook = hookFetch(async () =>
			sse([
				{
					id: "synthetic",
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "call_synthetic",
										type: "function",
										function: { name: "read", arguments: "{}" },
									},
								],
							},
						},
					],
				},
			]),
		);
		const result = await streamOpenAICompletions(
			{ ...model, compat: { supportsFinishReason: false } } as Model<"openai-completions">,
			{ messages: [] },
			{
				apiKey: "synthetic",
				onResponse: async () => {
					await Promise.resolve();
					seen.push("response");
				},
				onProviderStreamEvent: async () => {
					await Promise.resolve();
					seen.push("event");
				},
			},
		).result();
		expect(seen).toEqual(["response", "event"]);
		expect(result.stopReason).toBe("toolUse");
		expect(result.content).toMatchObject([{ type: "toolCall", id: "call_synthetic", arguments: {} }]);
	});
	it("interrupts a server retry delay without sending another request", async () => {
		const controller = new AbortController();
		let calls = 0;
		using _hook = hookFetch(async () => {
			calls++;
			setTimeout(() => controller.abort(), 20);
			return Response.json(
				{ error: { message: "synthetic retry" } },
				{ status: 429, headers: { "retry-after-ms": "2000" } },
			);
		});
		const started = performance.now();
		const result = await streamOpenAICompletions(
			model,
			{ messages: [] },
			{ apiKey: "synthetic", signal: controller.signal, maxRetries: 2 },
		).result();
		expect(result.stopReason).toBe("aborted");
		expect(calls).toBe(1);
		expect(performance.now() - started).toBeLessThan(1000);
	});
});
