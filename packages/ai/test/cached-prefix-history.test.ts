import { describe, expect, it } from "bun:test";
import type { Model, ProviderSessionState, ReasoningEffort, UserMessage } from "../src";
import { getBundledModel } from "../src/models";
import { streamOpenAIResponses } from "../src/providers/openai-responses";

describe("cached reasoning prefix history", () => {
	it("retains prior updates across multiple effort changes and drops stale anchors after context replacement", async () => {
		const model = getBundledModel("openai", "gpt-6.1-sol") as Model<"openai-responses">;
		const state = new Map<string, ProviderSessionState>();
		state.set(`openai-responses:${JSON.stringify([model.provider, model.id, model.baseUrl])}`, {
			nativeHistoryReplayWarmed: true,
			originalReasoning: "medium",
			close() {},
		} as ProviderSessionState);
		const bodies: any[] = [];
		const messages: UserMessage[] = [];
		for (const effort of ["high", "max", "medium"] as ReasoningEffort[]) {
			messages.push({ role: "user", content: `synthetic-${effort}`, timestamp: messages.length });
			await streamOpenAIResponses(
				model,
				{ messages: [...messages] },
				{
					apiKey: "synthetic",
					reasoning: effort,
					providerSessionState: state,
					fetch: async () =>
						new Response(
							`data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_synthetic", status: "completed", output: [] } })}\n\n`,
							{ headers: { "Content-Type": "text/event-stream" } },
						),
					onPayload: body => {
						bodies.push(body);
					},
				},
			).result();
		}
		expect(bodies[2].input.map((item: any) => item.reasoning?.effort).filter(Boolean)).toEqual([
			"high",
			"max",
			"medium",
		]);
		let replacement: any;
		await streamOpenAIResponses(
			model,
			{ messages: [{ role: "user", content: "replacement context", timestamp: 10 }] },
			{
				apiKey: "synthetic",
				reasoning: "max",
				providerSessionState: state,
				fetch: async () =>
					new Response(
						`data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_synthetic", status: "completed", output: [] } })}\n\n`,
						{ headers: { "Content-Type": "text/event-stream" } },
					),
				onPayload: body => {
					replacement = body;
				},
			},
		).result();
		expect(replacement.reasoning.effort).toBe("max");
		expect(replacement.input.some((item: any) => item.type === "configuration_update")).toBe(false);
	});
});
