import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { FinishReason } from "@google/genai";
import type { Context, Model } from "../src";
import { streamGoogle } from "../src/providers/google";
import { mapStopReason, mapStopReasonString } from "../src/providers/google-shared";
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
	it("reports resumable per-request token limits as length, not completed output", () => {
		expect(mapStopReason(FinishReason.CONTINUATION)).toBe("length");
		expect(mapStopReasonString(FinishReason.CONTINUATION)).toBe("length");
	});
	it.each([
		FinishReason.MISSING_THOUGHT_SIGNATURE,
		FinishReason.MALFORMED_RESPONSE,
		FinishReason.ESCALATION,
		FinishReason.PUP_LIMITED_DISABLED,
		FinishReason.MODEL_ARMOR,
	])("retains %s as an explicit error in typed and raw responses", reason => {
		expect(mapStopReason(reason)).toBe("error");
		expect(mapStopReasonString(reason)).toBe("error");
	});

	it("preserves a Vertex finish reason in the surfaced error contract", async () => {
		using _hook = hookFetch(() => safetyResponse());

		const message = await streamGoogleVertex(model("google-vertex"), context, {
			apiKey: "test-api-key",
			project: "synthetic-project",
			location: "global",
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
