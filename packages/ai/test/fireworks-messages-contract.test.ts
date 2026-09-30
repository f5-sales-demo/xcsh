import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { getBundledModels } from "../src/models";
import { convertAnthropicMessages, streamAnthropic } from "../src/providers/anthropic";
import type { AssistantMessage, Model } from "../src/types";

describe("Fireworks Messages compatibility", () => {
	it("keeps session affinity and omits unsupported tool cache controls", async () => {
		const model = {
			...getBundledModels("fireworks").find(model => model.api === "anthropic-messages")!,
			compat: { sendSessionAffinityHeaders: true, supportsCacheControlOnTools: false },
		} as Model<"anthropic-messages">;
		let headers = new Headers();
		let body: any;
		using _hook = hookFetch(async (_url, init) => {
			headers = new Headers(init?.headers);
			body = JSON.parse(String(init?.body));
			return new Response(
				'event: message_start\ndata: {"type":"message_start","message":{"id":"synthetic","usage":{}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
				{ headers: { "Content-Type": "text/event-stream" } },
			);
		});
		const result = await streamAnthropic(
			model,
			{ messages: [], tools: [{ name: "read", description: "Read", parameters: Type.Object({}) }] },
			{ apiKey: "synthetic", sessionId: "synthetic-session" },
		).result();
		expect(result.stopReason).toBe("stop");
		expect(headers.get("x-session-affinity")).toBe("synthetic-session");
		expect(body.tools[0]).not.toHaveProperty("cache_control");
	});
	it("replays allowed empty reasoning signatures", () => {
		const model = {
			...getBundledModels("fireworks")[0]!,
			api: "anthropic-messages",
			compat: { allowEmptySignature: true },
		} as Model<"anthropic-messages">;
		const message: AssistantMessage = {
			role: "assistant",
			provider: "fireworks",
			model: model.id,
			api: model.api,
			content: [
				{ type: "thinking", thinking: "synthetic reasoning", thinkingSignature: "" },
				{ type: "text", text: "done" },
			],
			timestamp: 0,
			stopReason: "stop",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		};
		expect(convertAnthropicMessages([message], model, false)[0].content).toContainEqual({
			type: "thinking",
			thinking: "synthetic reasoning",
			signature: "",
		});
	});
});
