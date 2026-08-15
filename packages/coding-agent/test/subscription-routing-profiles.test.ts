import { describe, expect, it } from "bun:test";
import { applySubscriptionProfileRoles, SUBSCRIPTION_ROUTING_PROFILES } from "../src/routing/subscription-profiles";

describe("subscription routing profiles", () => {
	it("defines the reviewed Google Antigravity role profile", () => {
		expect(SUBSCRIPTION_ROUTING_PROFILES["google-antigravity"]?.roles).toEqual({
			smol: "google-antigravity/gemini-3.6-flash-high:high",
			default: "google-antigravity/gemini-3.6-flash-high:high",
			slow: "google-antigravity/gemini-3.1-pro-high-vertex:high",
			plan: "google-antigravity/gemini-3.1-pro-high-vertex:high",
		});
	});

	it("fails closed without changing roles when a required entitlement is absent", () => {
		const current = { default: "anthropic/claude-sonnet-4-6:high", commit: "pi/smol" };
		const result = applySubscriptionProfileRoles("google-antigravity", current, [
			"google-antigravity/gemini-3.6-flash-high",
		]);

		expect(result.applied).toBe(false);
		expect(result.roles).toEqual(current);
		expect(result.missingModels).toEqual(["google-antigravity/gemini-3.1-pro-high-vertex"]);
	});
});
