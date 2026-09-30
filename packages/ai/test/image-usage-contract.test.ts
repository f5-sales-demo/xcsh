import { describe, expect, it } from "bun:test";
import { generateImages } from "../src/operations";
import type { ImageModel } from "../src/types";

const model: ImageModel = {
	id: "synthetic",
	name: "Synthetic",
	provider: "openrouter",
	api: "openrouter-images",
	type: "image",
	input: ["text"],
	output: ["image"],
	baseUrl: "https://api.example.com/v1",
	cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
};
describe("image operation usage", () => {
	it("keeps cache reads and writes independent and retains reported reasoning", async () => {
		const result = await generateImages(
			model,
			{ input: [{ type: "text", text: "synthetic" }] },
			{
				apiKey: "synthetic",
				fetch: async () =>
					Response.json({
						choices: [{ message: { images: [{ image_url: "data:image/png;base64,AQID" }] } }],
						usage: {
							prompt_tokens: 100,
							completion_tokens: 20,
							prompt_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 },
							completion_tokens_details: { reasoning_tokens: 5 },
						},
					}),
			},
		);
		expect(result.stopReason).toBe("stop");
		expect(result.usage).toMatchObject({
			input: 60,
			output: 20,
			cacheRead: 30,
			cacheWrite: 10,
			totalTokens: 120,
			reasoningTokens: 5,
			cacheWriteTokens: 10,
		});
	});
});
