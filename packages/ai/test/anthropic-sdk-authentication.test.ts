import { describe, expect, it } from "bun:test";
import { streamAnthropic } from "../src/providers/anthropic";
import type { Model } from "../src/types";

const model: Model<"anthropic-messages"> = {
	id: "claude-haiku-5-5",
	name: "Haiku",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "http://127.0.0.1:1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 8192,
};

function fixture(headers: Headers[]) {
	return async (_input: string | URL | Request, init?: RequestInit) => {
		headers.push(new Headers(init?.headers));
		const events = [
			{
				type: "message_start",
				message: { id: "msg_auth", model: model.id, usage: { input_tokens: 1, output_tokens: 0 } },
			},
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "ok" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
			{ type: "message_stop" },
		];
		return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
			headers: { "content-type": "text/event-stream" },
		});
	};
}

describe("Anthropic SDK 1.14 authentication", () => {
	it("uses the SDK Bearer API-key contract through the injected transport", async () => {
		const headers: Headers[] = [];
		const result = await streamAnthropic(
			model,
			{ messages: [{ role: "user", content: "test", timestamp: 1 }] },
			{ apiKey: "test-api-key", fetch: fixture(headers) },
		).result();
		expect(result.stopReason).toBe("stop");
		expect(headers[0].get("authorization")).toBe("Bearer test-api-key");
		expect(headers[0].get("x-api-key")).toBeNull();
	});
	it("accepts an explicit auth token without claiming subscription billing", async () => {
		const headers: Headers[] = [];
		const result = await streamAnthropic(model, { messages: [{ role: "user", content: "test", timestamp: 1 }] }, {
			authentication: { authToken: "test-bearer" },
			fetch: fixture(headers),
		} as any).result();
		expect(result.stopReason).toBe("stop");
		expect(headers[0].get("authorization")).toBe("Bearer test-bearer");
		expect(result.usage.billing).not.toBe("subscription");
	});
	it("lets the SDK mint workload credentials and avoids an API-key fallback", async () => {
		const headers: Headers[] = [];
		let minted = 0;
		const result = await streamAnthropic(model, { messages: [{ role: "user", content: "test", timestamp: 1 }] }, {
			authentication: {
				credentials: async () => {
					minted++;
					return { token: "workload-token", expiresAt: null };
				},
			},
			fetch: fixture(headers),
		} as any).result();
		expect(result.stopReason).toBe("stop");
		expect(headers[0].get("authorization")).toBe("Bearer workload-token");
		expect(minted).toBe(1);
	});
});
