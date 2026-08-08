import { describe, expect, it } from "bun:test";
import { Settings } from "../src/config/settings";
import { parseRoutingPoolConfig } from "../src/routing/config";

describe("Routing Configuration (R01)", () => {
	it("should provide expected default routing settings", () => {
		const s = Settings.isolated();
		expect(s.get("routing.mode")).toBe("off");
		expect(s.get("routing.profiler")).toBe("hybrid");
		expect(s.get("routing.familyPolicy")).toBe("sticky");
		expect(s.get("routing.delegation")).toBe("read-only");
		expect(s.get("routing.delegationMaxTasks")).toBe(3);
		expect(s.get("routing.downshiftAfterTurns")).toBe(2);
		expect(s.get("routing.disabledPresets")).toEqual([]);
	});

	it("should parse and validate pool configs with ordered selectors", () => {
		const validPool = {
			id: "custom-openai",
			provider: "openai",
			tiers: {
				utility: "gpt-4o-mini",
				balanced: "gpt-4o",
				frontier: "o3-mini",
			},
		};
		const parsed = parseRoutingPoolConfig(validPool);
		expect(parsed.valid).toBe(true);
		expect(parsed.pool?.tiers.utility).toBe("gpt-4o-mini");
	});

	it("should reject invalid pool configs with missing tiers or duplicate selectors", () => {
		const invalidPool = {
			id: "invalid-pool",
			provider: "openai",
			tiers: {
				utility: "gpt-4o-mini",
				balanced: "gpt-4o-mini", // duplicate!
				frontier: "o3-mini",
			},
		};
		const parsed = parseRoutingPoolConfig(invalidPool);
		expect(parsed.valid).toBe(false);
		expect(parsed.errors).toContain("Duplicate selector 'gpt-4o-mini' in pool 'invalid-pool'");
	});

	it("should validate mixed pools require explicit allowMixed flag", () => {
		const mixedPool = {
			id: "mixed-pool",
			tiers: {
				utility: "openai/gpt-4o-mini",
				balanced: "anthropic/claude-3-5-sonnet",
				frontier: "openai/o3-mini",
			},
		};
		const unflagged = parseRoutingPoolConfig(mixedPool);
		expect(unflagged.valid).toBe(false);

		const flagged = parseRoutingPoolConfig({ ...mixedPool, allowMixed: true });
		expect(flagged.valid).toBe(true);
	});
});
