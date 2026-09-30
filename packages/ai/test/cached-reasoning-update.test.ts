import { describe, expect, it } from "bun:test";
import { getBundledModel } from "../src/models";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import type { Model, ProviderSessionState } from "../src/types";

describe("cached reasoning configuration updates", () => {
	it("anchors effort changes without changing the original hidden prefix", async () => {
		const providerSessionState = new Map<string, ProviderSessionState>();
		const model = {
			...getBundledModel("openai", "gpt-6.1-sol"),
			compat: { supportsCachedReasoningUpdates: true },
		} as Model<"openai-responses">;
		const context = { messages: [{ role: "user" as const, content: "Synthetic", timestamp: 0 }] };
		const payloads: any[] = [];
		providerSessionState.set(`openai-responses:${JSON.stringify([model.provider, model.id, model.baseUrl])}`, {
			nativeHistoryReplayWarmed: true,
			originalReasoning: "medium",
			close() {},
		} as ProviderSessionState);
		for (const reasoning of ["medium", "high"] as const)
			await streamOpenAIResponses(model, context, {
				apiKey: "synthetic",
				reasoning,
				providerSessionState,
				onPayload: value => {
					payloads.push(value);
				},
				signal: AbortSignal.abort(),
			}).result();
		expect(payloads[1].reasoning.effort).toBe("medium");
		expect(payloads[1].input.at(-1)).toEqual({ type: "configuration_update", reasoning: { effort: "high" } });
		const other: any[] = [];
		await streamOpenAIResponses({ ...model, baseUrl: "https://different.example.com/v1" }, context, {
			apiKey: "synthetic",
			reasoning: "max",
			providerSessionState,
			onPayload: value => {
				other.push(value);
			},
			signal: AbortSignal.abort(),
		}).result();
		expect(other[0].reasoning.effort).toBe("max");
	});
});
