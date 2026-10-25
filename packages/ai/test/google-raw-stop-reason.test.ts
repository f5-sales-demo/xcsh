import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import type { Context, Model } from "../src";
import { streamGoogle } from "../src/providers/google";
import { streamGoogleVertex } from "../src/providers/google-vertex";

const context: Context = {
	messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
};

function model<TApi extends "google-generative-ai" | "google-vertex">(api: TApi): Model<TApi> {
	return {
		id: "gemini-3.6-flash",
		name: "Gemini 3.6 Flash",
		api,
		provider: api === "google-vertex" ? "google-vertex" : "google",
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 65_536,
	};
}

function safetyResponse(): Response {
	const body = [
		'data: {"candidates":[{"finishReason":"SAFETY"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":0,"totalTokenCount":1}}',
		"",
		"",
	].join("\n");
	return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("Google raw stop reasons", () => {
	it.skip("preserves a Vertex finish reason in the surfaced error contract", async () => {
		using _hook = hookFetch(() => safetyResponse());

		const message = await streamGoogleVertex(model("google-vertex"), context, {
			apiKey: "test-api-key",
		}).result();

		expect(message.stopReason).toBe("error");
		expect(message.rawStopReason).toBe("SAFETY");
		expect(message.errorMessage).toBe("Gemini stopped with SAFETY");
	});

	it("preserves a Generative AI finish reason in the surfaced error contract", async () => {
		using _hook = hookFetch(() => safetyResponse());

		const message = await streamGoogle(model("google-generative-ai"), context, {
			apiKey: "test-api-key",
		}).result();

		expect(message.stopReason).toBe("error");
		expect(message.rawStopReason).toBe("SAFETY");
		expect(message.errorMessage).toBe("Gemini stopped with SAFETY");
	});
});

it("retains text and finishes automatic continuation instead of treating it as a model error", async () => {
	let requests = 0;
	using _hook = hookFetch(() => {
		requests++;
		const continued = requests > 1;
		const payload = {
			candidates: [
				{
					content: { role: "model", parts: [{ text: continued ? "complete" : "partial " }] },
					finishReason: continued ? "STOP" : "CONTINUATION",
					...(continued ? {} : { continuationToken: "synthetic-continuation-token" }),
				},
			],
		};
		return new Response("data: " + JSON.stringify(payload) + "\n\n", {
			headers: { "Content-Type": "text/event-stream" },
		});
	});
	const message = await streamGoogle(model("google-generative-ai"), context, { apiKey: "test-api-key" }).result();
	expect(requests).toBe(2);
	expect(message.stopReason).toBe("stop");
	expect(
		message.content
			.filter(part => part.type === "text")
			.map(part => part.text)
			.join(""),
	).toBe("partial complete");
});

it("preserves a paused continuation response as incomplete text rather than an error", async () => {
	using _hook = hookFetch(
		() =>
			new Response(
				'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"partial"}]},"finishReason":"CONTINUATION"}]}\n\n',
				{ headers: { "Content-Type": "text/event-stream" } },
			),
	);
	const message = await streamGoogle(model("google-generative-ai"), context, { apiKey: "test-api-key" }).result();
	expect(message.stopReason).toBe("length");
	expect(message.rawStopReason).toBe("CONTINUATION");
	expect(
		message.content
			.filter(part => part.type === "text")
			.map(part => part.text)
			.join(""),
	).toBe("partial");
});
