import { describe, expect, it } from "bun:test";
import { fetchDeferred, requestDeferred } from "../src/deferred";
import { getBundledModel } from "../src/models";

const model = getBundledModel("openai", "gpt-6.1-sol");
describe("deferred request lifecycle", () => {
	it("aborts the wire request at its configured timeout", async () => {
		let signal: AbortSignal | null | undefined;
		const request = requestDeferred(
			model,
			{ messages: [] },
			{
				apiKey: "synthetic",
				timeoutMs: 20,
				fetch: async (_url, init) => {
					signal = init?.signal;
					return new Promise<Response>((_resolve, reject) =>
						signal?.addEventListener("abort", () => reject(signal?.reason), { once: true }),
					);
				},
			},
		);
		await expect(request).rejects.toThrow();
		expect(signal?.aborted).toBe(true);
	});
	it("retains request identity controls after a replacement hook", async () => {
		let payload: any;
		const handle = await requestDeferred(
			model,
			{ messages: [] },
			{
				apiKey: "synthetic",
				onPayload: () => ({ model: model.id, input: [], stream: true, store: false }),
				fetch: async (_url, init) => {
					payload = JSON.parse(String(init?.body));
					return Response.json({ id: "resp_synthetic", status: "queued", output: [] });
				},
			},
		);
		expect(payload).toMatchObject({ background: true, stream: false, store: true });
		await expect(fetchDeferred(model, { ...handle, expiresAt: 1 }, { apiKey: "synthetic" })).rejects.toThrow(
			"expired",
		);
	});
});
