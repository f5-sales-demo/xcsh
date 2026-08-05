import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { fetchAntigravityDiscoveryModels } from "../src/utils/discovery/antigravity";

describe("Google Antigravity model discovery", () => {
	it("discovers the entitled Gemini 3.6 Flash effort variants", async () => {
		let requestUrl: string | undefined;
		let requestHeaders: Headers | undefined;
		using _hook = hookFetch((input, init) => {
			requestUrl = String(input);
			requestHeaders = new Headers(init?.headers);
			return new Response(
				JSON.stringify({
					models: {
						"gemini-3.6-flash-high": {
							displayName: "Gemini 3.6 Flash High",
							supportsImages: true,
							supportsThinking: true,
							maxTokens: 1_048_576,
							maxOutputTokens: 65_536,
						},
						"gemini-3.6-flash-medium": {
							displayName: "Gemini 3.6 Flash Medium",
							supportsImages: true,
							supportsThinking: true,
						},
						"gemini-3.6-flash-low": {
							displayName: "Gemini 3.6 Flash Low",
							supportsImages: true,
							supportsThinking: true,
						},
						"gemini-3.1-pro-high": {
							displayName: "Gemini 3.1 Pro High",
							supportsImages: true,
							supportsThinking: true,
						},
					},
				}),
			);
		});

		const models = await fetchAntigravityDiscoveryModels({ token: "access-token" });

		expect(requestUrl).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels");
		expect(requestHeaders?.get("Authorization")).toBe("Bearer access-token");
		expect(requestHeaders?.get("User-Agent")).toMatch(/^antigravity\/2\.4\.3 /);
		expect(models?.map(model => model.id).sort()).toEqual([
			"gemini-3.1-pro-high-vertex",
			"gemini-3.6-flash-high",
			"gemini-3.6-flash-low",
			"gemini-3.6-flash-medium",
		]);
		expect(models?.find(model => model.id === "gemini-3.6-flash-high")).toMatchObject({
			api: "google-gemini-cli",
			provider: "google-antigravity",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 1_048_576,
			maxTokens: 65_536,
		});
		expect(models?.find(model => model.id === "gemini-3.1-pro-high-vertex")).toMatchObject({
			id: "gemini-3.1-pro-high-vertex",
			name: "Gemini 3.1 Pro High (Vertex, Antigravity)",
			api: "google-gemini-cli",
			provider: "google-antigravity",
			baseUrl: "https://aiplatform.googleapis.com",
		});
	});
});
