import { describe, expect, it } from "bun:test";
import { mapTierToEffort } from "../src/routing/effort";

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
});
