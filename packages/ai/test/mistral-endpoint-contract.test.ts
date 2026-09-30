import { describe, expect, it } from "bun:test";
import { getBundledModels } from "../src/models";
import { stream } from "../src/providers/mistral-conversations";

describe("Mistral native endpoint", () => {
	it("retains configured prefixes with exactly one API version", async () => {
		for (const baseUrl of [
			"https://api.mistral.ai",
			"https://api.mistral.ai/v1",
			"https://proxy.example.com/prefix/v1",
		]) {
			let url = "";
			const result = await stream(
				{ ...getBundledModels("mistral")[0]!, api: "mistral-conversations", compat: undefined, baseUrl },
				{ messages: [] },
				{
					apiKey: "synthetic",
					fetch: async input => {
						url = String(input);
						return new Response(
							'data: {"choices":[{"index":0,"delta":{"content":"synthetic"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
						);
					},
				},
			).result();
			expect(result.stopReason).toBe("stop");
			expect(url).toBe(`${baseUrl.replace(/\/v1$/, "")}/v1/chat/completions`);
		}
	});
});
