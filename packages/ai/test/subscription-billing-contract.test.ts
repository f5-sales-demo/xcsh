import { describe, expect, it } from "bun:test";
import { calculateCost, getBundledModel } from "../src/models";
import type { Usage } from "../src/types";

describe("subscription usage accounting", () => {
	it("preserves subscription billing when costs are updated and identifies Gemini subscriptions", () => {
		const usage: Usage = {
			billing: "subscription",
			input: 10,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 11,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		calculateCost(getBundledModel("anthropic", "claude-sonnet-5"), usage);
		expect(String(usage.billing)).toBe("subscription");
		for (const provider of ["google-gemini-cli", "google-antigravity"]) {
			delete usage.billing;
			calculateCost({ provider, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }, usage);
			expect(String(usage.billing)).toBe("subscription");
		}
	});
});
