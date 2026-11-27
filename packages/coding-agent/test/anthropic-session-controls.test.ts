import { describe, expect, it } from "bun:test";
import { resolveAnthropicSessionControls } from "../src/session/anthropic-controls";

describe("Anthropic session controls", () => {
	it("restores the latest branch controls instead of unrelated current settings", () => {
		const entries = [
			{
				type: "custom",
				customType: "anthropic-controls",
				data: { thinkingDisplay: "omitted", taskBudget: { type: "tokens", total: 20000 } },
			},
			{ type: "custom", customType: "other", data: { thinkingDisplay: "summarized" } },
		];
		expect(resolveAnthropicSessionControls({ thinkingDisplay: "summarized" }, entries)).toEqual({
			thinkingDisplay: "omitted",
			taskBudget: { type: "tokens", total: 20000 },
		});
	});
	it("copies controls so a caller cannot change persisted budgets while building a request", () => {
		const settings = { taskBudget: { type: "tokens", total: 20000, remaining: 10000 } };
		const resolved = resolveAnthropicSessionControls(settings, []);
		resolved.taskBudget!.remaining = 1;
		expect(settings.taskBudget.remaining).toBe(10000);
	});
	it("rejects invalid persisted controls rather than silently omitting them", () => {
		expect(() => resolveAnthropicSessionControls({ thinkingDisplay: "bogus" }, [])).toThrow("Anthropic");
	});
});
