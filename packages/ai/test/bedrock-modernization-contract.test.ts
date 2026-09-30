import { describe, expect, it, spyOn } from "bun:test";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { streamBedrock } from "../src/providers/amazon-bedrock";
import type { Model } from "../src/types";

const model: Model<"bedrock-converse-stream"> = {
	id: "synthetic",
	name: "Synthetic",
	api: "bedrock-converse-stream",
	provider: "amazon-bedrock",
	baseUrl: "",
	reasoning: false,
	input: ["text"],
	contextWindow: 32000,
	maxTokens: 2000,
	cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 1.25 },
};
describe("Bedrock streaming contracts", () => {
	it("awaits replacement hooks and observers and replays redacted reasoning", async () => {
		let payload: any;
		const seen: string[] = [];
		const mock = spyOn(BedrockRuntimeClient.prototype, "send").mockImplementation(async command => {
			payload = (command as any).input;
			return {
				$metadata: { httpStatusCode: 200, requestId: "synthetic" },
				stream: (async function* () {
					yield { messageStart: { role: "assistant" } };
					yield {
						contentBlockDelta: {
							contentBlockIndex: 0,
							delta: { reasoningContent: { redactedContent: new Uint8Array([1, 2, 3]) } },
						},
					};
					yield { contentBlockStop: { contentBlockIndex: 0 } };
					yield { messageStop: { stopReason: "end_turn" } };
					yield {
						metadata: {
							usage: { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 3, cacheWriteInputTokens: 4 },
						},
					};
				})(),
			};
		});
		try {
			const result = await streamBedrock(
				model,
				{ messages: [] },
				{
					onPayload: async value => {
						await Promise.resolve();
						return { ...(value as object), modelId: "replacement" };
					},
					onResponse: async () => {
						seen.push("response");
					},
					onProviderStreamEvent: async () => {
						seen.push("event");
					},
				},
			).result();
			expect(result.stopReason).toBe("stop");
			expect(payload.modelId).toBe("replacement");
			expect(seen[0]).toBe("response");
			expect(seen.filter(value => value === "event")).toHaveLength(5);
			expect(result.content).toMatchObject([{ type: "redactedThinking", data: "AQID" }]);
			expect(result.usage).toMatchObject({ totalTokens: 19, cacheWriteTokens: 4 });
			await streamBedrock(model, { messages: [result] }, {}).result();
			expect(payload.messages[0].content[0].reasoningContent.redactedContent).toEqual(new Uint8Array([1, 2, 3]));
		} finally {
			mock.mockRestore();
		}
	});
});
