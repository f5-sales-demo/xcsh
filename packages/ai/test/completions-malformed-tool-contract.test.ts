import { describe, expect, it } from "bun:test";
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { getBundledModel } from "../src/models";
import { streamOpenAICompletions } from "../src/providers/openai-completions";
import type { Model } from "../src/types";

describe("completed completion tool arguments", () => {
	it("refuses malformed completed JSON before tool dispatch", async () => {
		using _hook = hookFetch(
			async () =>
				new Response(
					'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"synthetic","function":{"name":"write","arguments":"{\\"path\\":"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
					{ headers: { "Content-Type": "text/event-stream" } },
				),
		);
		const result = await streamOpenAICompletions(
			{ ...getBundledModel("openai", "gpt-4o-mini"), api: "openai-completions" } as Model<"openai-completions">,
			{ messages: [] },
			{ apiKey: "synthetic" },
		).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("malformed");
	});
});
