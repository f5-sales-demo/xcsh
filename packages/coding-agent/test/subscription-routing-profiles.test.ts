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

	it("defines the reviewed OpenAI Codex role profile and tier pool", () => {
		const profile = SUBSCRIPTION_ROUTING_PROFILES["openai-codex"];
		expect(profile?.roles).toEqual({
			smol: "openai-codex/gpt-5.6-luna:low",
			default: "openai-codex/gpt-5.6-terra:medium",
			slow: "openai-codex/gpt-5.6-sol:high",
			plan: "openai-codex/gpt-5.6-sol:high",
		});
		expect(profile?.pool).toMatchObject({
			id: "openai-codex/gpt-5.6",
			provider: "openai-codex",
			tiers: { utility: "gpt-5.6-luna", balanced: "gpt-5.6-terra", frontier: "gpt-5.6-sol" },
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

	it("atomically replaces only managed roles after every model is entitled", () => {
		const result = applySubscriptionProfileRoles(
			"openai-codex",
			{ default: "old/default", vision: "google/vision", custom: "custom/model" },
			["openai-codex/gpt-5.6-luna", "openai-codex/gpt-5.6-terra", "openai-codex/gpt-5.6-sol"],
		);

		expect(result.applied).toBe(true);
		expect(result.missingModels).toEqual([]);
		expect(result.roles).toMatchObject({
			vision: "google/vision",
			custom: "custom/model",
			default: "openai-codex/gpt-5.6-terra:medium",
		});
	});
});
