import { describe, expect, it } from "bun:test";
import { checkCandidateContextEligible } from "../src/routing/context-filter";

describe("Context & Capability Filtering (P06)", () => {
	it("should return true when estimated tokens fit safely in context window", () => {
		const eligible = checkCandidateContextEligible({
			estimatedInputTokens: 10000,
			reserveTokens: 8000,
			candidateContextWindow: 128000,
		});
		expect(eligible).toBe(true);
	});

	it("should return false when estimated input + reserve exceeds candidate context window", () => {
		const eligible = checkCandidateContextEligible({
			estimatedInputTokens: 115000,
			reserveTokens: 20000,
			candidateContextWindow: 128000, // 115k + 20k = 135k > 128k
		});
		expect(eligible).toBe(false);
	});

	it("should enforce at least 15% reserve calculation if reserveTokens is small", () => {
		const eligible = checkCandidateContextEligible({
			estimatedInputTokens: 110000,
			reserveTokens: 2000, // small reserve
			candidateContextWindow: 128000, // 15% of 128k = 19,200. 110k + 19.2k = 129.2k > 128k -> false
		});
		expect(eligible).toBe(false);
	});
});
