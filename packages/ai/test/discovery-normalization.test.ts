import { describe, expect, it } from "bun:test";
import { fetchOpenAICompatibleModels } from "../src/utils/discovery/openai-compatible";

describe("provider discovery normalization", () => {
	it("does not reinstate a model rejected by the provider mapper", async () => {
		const result = await fetchOpenAICompatibleModels({
			provider: "synthetic",
			api: "openai-completions",
			baseUrl: "https://synthetic.example.com/v1",
			fetch: (async () => Response.json({ data: [{ id: "rejected" }] })) as unknown as typeof fetch,
			mapModel: () => null,
		});
		expect(result).toEqual([]);
	});
	it("propagates caller cancellation without publishing a null catalog", async () => {
		await expect(
			fetchOpenAICompatibleModels({
				provider: "synthetic",
				api: "openai-completions",
				baseUrl: "https://synthetic.example.com/v1",
				signal: AbortSignal.abort(),
				fetch: (async (_url: unknown, init: RequestInit) => {
					init.signal?.throwIfAborted();
					return Response.json({ data: [] });
				}) as unknown as typeof fetch,
			}),
		).rejects.toThrow();
	});
});
