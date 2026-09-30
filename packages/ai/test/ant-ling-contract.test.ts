import { describe, expect, it } from "bun:test";
import type { Effort } from "../src/model-thinking";
import { getBundledModel } from "../src/models";
import { streamSimple } from "../src/stream";

describe("Ant Ling reasoning transport", () => {
	it("offers documented Ring efforts and emits nested reasoning", async () => {
		const model = getBundledModel("ant-ling", "Ring-2.6-1T");
		expect(model.thinking?.supportedLevels.map(level => level.effort)).toEqual(["high", "xhigh"]);
		for (const effort of ["high", "xhigh"] as Effort[]) {
			let body: any;
			await streamSimple(
				model,
				{ messages: [{ role: "user", content: "synthetic", timestamp: 0 }] },
				{
					apiKey: "synthetic",
					reasoning: effort,
					signal: AbortSignal.abort(),
					onPayload: value => {
						body = value;
					},
				},
			).result();
			expect(body.reasoning).toEqual({ effort });
			expect(body).not.toHaveProperty("reasoning_effort");
		}
	});
});
