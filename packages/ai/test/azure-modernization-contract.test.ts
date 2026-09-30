import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { Effort } from "../src/model-thinking";
import { getBundledModel } from "../src/models";
import { streamAzureOpenAIResponses } from "../src/providers/azure-openai-responses";
import { mapOptionsForApi } from "../src/stream";
import type { Model } from "../src/types";

const model = {
	...getBundledModel("openai", "gpt-6.1-sol"),
	provider: "azure-openai-responses",
	api: "azure-openai-responses",
	baseUrl: "https://example.openai.azure.com/openai/v1",
} as Model<"azure-openai-responses">;
describe("Azure Responses capability parity", () => {
	it("preserves max reasoning and omits summary none", () => {
		expect(mapOptionsForApi(model, { reasoning: Effort.Max, reasoningSummary: "none" })).toMatchObject({
			reasoning: "max",
			reasoningSummary: "none",
		});
	});
	it("uses shared custom tools, caching and response observers", async () => {
		let body: any;
		let responses = 0;
		let events = 0;
		using _hook = hookFetch(async (_input, init) => {
			body = JSON.parse(String(init?.body));
			return new Response('data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n', {
				headers: { "Content-Type": "text/event-stream" },
			});
		});
		const result = await streamAzureOpenAIResponses(
			model,
			{
				messages: [],
				tools: [
					{
						name: "patch",
						description: "Patch",
						parameters: Type.Object({ input: Type.String() }),
						constrainedSampling: { type: "grammar", variants: { openai_lark: "start: /.+/" } },
					},
				],
			},
			{
				apiKey: "synthetic",
				azureDeploymentName: "synthetic-deployment",
				reasoning: "max",
				reasoningSummary: "none",
				promptCache: { mode: "explicit", ttl: "30m" },
				onResponse: async () => {
					responses++;
				},
				onProviderStreamEvent: async () => {
					events++;
				},
			} as any,
		).result();
		expect(result.stopReason).toBe("stop");
		expect(body.model).toBe("synthetic-deployment");
		expect(body.reasoning).toEqual({ effort: "max" });
		expect(body.prompt_cache_options).toEqual({ mode: "explicit", ttl: "30m" });
		expect(body.tools[0]).toMatchObject({ type: "custom", name: "patch" });
		expect(responses).toBe(1);
		expect(events).toBe(1);
	});
});
