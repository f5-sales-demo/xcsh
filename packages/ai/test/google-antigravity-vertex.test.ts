import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { streamGoogleGeminiCli } from "../src/providers/google-gemini-cli";
import type { Context, Model } from "../src/types";

const context: Context = {
	messages: [{ role: "user", content: "Reply with VERTEX_OK", timestamp: Date.now() }],
};

describe("Google Antigravity Vertex transport", () => {
	it.each([
		["gemini-3.6-flash-high", "gemini-3.6-flash"],
		["gemini-3.1-pro-high", "gemini-3.1-pro-preview"],
		["gemini-3.1-pro-high-vertex", "gemini-3.1-pro-preview"],
	] as const)("routes %s through the enterprise Vertex endpoint as %s", async (modelId, vertexModelId) => {
		let requestUrl: string | undefined;
		let requestHeaders: Headers | undefined;
		let requestBody: Record<string, unknown> | undefined;
		const model: Model<"google-gemini-cli"> = {
			id: modelId,
			name: modelId,
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: "https://daily-cloudcode-pa.googleapis.com",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_048_576,
			maxTokens: 65_536,
		};
		using _hook = hookFetch((input, init) => {
			requestUrl = String(input);
			requestHeaders = new Headers(init?.headers);
			requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
			const responseChunk = {
				candidates: [
					{
						content: { role: "model", parts: [{ text: "VERTEX_OK" }] },
						finishReason: "STOP",
					},
				],
				usageMetadata: {
					promptTokenCount: 4,
					candidatesTokenCount: 3,
					totalTokenCount: 7,
				},
			};
			return new Response(`data: ${JSON.stringify(responseChunk)}\n\n`, {
				headers: { "Content-Type": "text/event-stream" },
			});
		});

		const result = await streamGoogleGeminiCli(model, context, {
			apiKey: JSON.stringify({ token: "xcsh-access-token", projectId: "enterprise-project" }),
			thinking: { enabled: true, level: "HIGH" },
		}).result();

		expect(requestUrl).toBe(
			`https://aiplatform.googleapis.com/v1/projects/enterprise-project/locations/global/publishers/google/models/${vertexModelId}:streamGenerateContent?alt=sse`,
		);
		expect(requestHeaders?.get("Authorization")).toBe("Bearer xcsh-access-token");
		expect(requestBody).not.toHaveProperty("project");
		expect(requestBody).not.toHaveProperty("model");
		expect(requestBody).not.toHaveProperty("request");
		expect(requestBody).toMatchObject({
			contents: [{ role: "user", parts: [{ text: "Reply with VERTEX_OK" }] }],
			generationConfig: {
				thinkingConfig: {
					includeThoughts: true,
					thinkingLevel: "HIGH",
				},
			},
		});
		expect(result.stopReason).toBe("stop");
		expect(result.content).toContainEqual(expect.objectContaining({ type: "text", text: "VERTEX_OK" }));
		expect(result.usage.totalTokens).toBe(7);
	});
});
