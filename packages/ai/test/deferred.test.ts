import { describe, expect, it } from "bun:test";
import { cancelDeferred, fetchDeferred, requestDeferred } from "../src/deferred";
import { getBundledModel } from "../src/models";

describe("typed deferred Responses operations", () => {
	it("creates, polls and cancels with route-bound handles", async () => {
		const model = getBundledModel("openai", "gpt-6.1-sol");
		const calls: string[] = [];
		const fetch = async (url: string | URL | Request, init?: RequestInit) => {
			calls.push(`${init?.method ?? "GET"} ${url}`);
			return Response.json({
				id: "resp_synthetic",
				status: calls.length === 1 ? "queued" : "completed",
				output: [],
			});
		};
		const handle = await requestDeferred(model, { messages: [] }, { apiKey: "synthetic", fetch });
		expect(handle).toMatchObject({ provider: "openai", modelId: "gpt-6.1-sol", id: "resp_synthetic" });
		expect((await fetchDeferred(model, handle, { apiKey: "synthetic", fetch })).stopReason).toBe("stop");
		await cancelDeferred(model, handle, { apiKey: "synthetic", fetch });
		expect(calls[2]).toBe("POST https://api.openai.com/v1/responses/resp_synthetic/cancel");
		await expect(
			fetchDeferred({ ...model, provider: "litellm" }, handle, { apiKey: "synthetic", fetch }),
		).rejects.toThrow("handle");
	});
	it("rejects unsupported subscription requests and pre-aborted work", async () => {
		await expect(
			requestDeferred(getBundledModel("openai-codex", "gpt-6.1-sol"), { messages: [] }, { apiKey: "synthetic" }),
		).rejects.toThrow("unsupported");
		await expect(
			requestDeferred(
				getBundledModel("openai", "gpt-6.1-sol"),
				{ messages: [] },
				{ apiKey: "synthetic", signal: AbortSignal.abort() },
			),
		).rejects.toThrow();
	});
});
