import { describe, expect, it } from "bun:test";
import { mapTierToEffort, resolveRoutingEffort } from "../src/routing/effort";

describe("Model Effort Compatibility (R07)", () => {
	it("should map utility, balanced, frontier to low, medium, high by default", () => {
		expect(mapTierToEffort("utility")).toBe("low");
		expect(mapTierToEffort("balanced")).toBe("medium");
		expect(mapTierToEffort("frontier")).toBe("high");
	});

	it("should respect custom tierEffort settings mapping", () => {
		const custom = { utility: "minimal", balanced: "low", frontier: "max" };
		expect(mapTierToEffort("utility", custom)).toBe("minimal");
		expect(mapTierToEffort("balanced", custom)).toBe("low");
		expect(mapTierToEffort("frontier", custom)).toBe("max");
	});

	it("uses a pool policy for normal tier effort and xhigh frontier escalation", () => {
		const policy = {
			byTier: { utility: "low", balanced: "medium", frontier: "high" },
			frontierEscalation: { effort: "xhigh", minimumComplexityScore: 90 },
		} as const;

		expect(resolveRoutingEffort("utility", 10, false, policy)).toEqual({ effort: "low", reason: "tier_default" });
		expect(resolveRoutingEffort("frontier", 89, false, policy)).toEqual({
			effort: "high",
			reason: "tier_default",
		});
		expect(resolveRoutingEffort("frontier", 90, false, policy)).toEqual({
			effort: "xhigh",
			reason: "complexity_escalation",
		});
		expect(resolveRoutingEffort("frontier", 70, true, policy)).toEqual({
			effort: "xhigh",
			reason: "rejection_escalation",
		});
	});
});
