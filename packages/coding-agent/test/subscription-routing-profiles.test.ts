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

	it("defines the Claude subscription role profile and escalation pool", () => {
		const profile = SUBSCRIPTION_ROUTING_PROFILES.anthropic;
		expect(profile?.roles).toEqual({
			smol: "anthropic/claude-haiku-4-5:low",
			default: "anthropic/claude-sonnet-5:medium",
			slow: "anthropic/claude-opus-5:high",
			plan: "anthropic/claude-opus-5:high",
		});
		expect(profile?.pool).toMatchObject({
			id: "anthropic/claude",
			tiers: { utility: "claude-haiku-4-5", balanced: "claude-sonnet-5", frontier: "claude-opus-5" },
			effortPolicy: {
				byTier: { utility: "low", balanced: "medium", frontier: "high" },
				frontierEscalation: { effort: "xhigh", minimumComplexityScore: 90 },
			},
		});
	});

	it("persists an exact dated Haiku entitlement while requiring all Claude tiers", () => {
		const result = applySubscriptionProfileRoles(
			"anthropic",
			{ vision: "google/vision", reviewer: "custom/reviewer" },
			["anthropic/claude-haiku-4-5-20251001", "anthropic/claude-sonnet-5", "anthropic/claude-opus-5"],
		);
		expect(result.applied).toBe(true);
		expect(result.roles).toMatchObject({
			smol: "anthropic/claude-haiku-4-5-20251001:low",
			default: "anthropic/claude-sonnet-5:medium",
			slow: "anthropic/claude-opus-5:high",
			plan: "anthropic/claude-opus-5:high",
			vision: "google/vision",
			reviewer: "custom/reviewer",
		});
	});

	it("does not substitute an older Claude generation when Sonnet 5 is absent", () => {
		const current = { default: "openai/gpt-5.6-sol:high" };
		const result = applySubscriptionProfileRoles("anthropic", current, [
			"anthropic/claude-haiku-4-5",
			"anthropic/claude-sonnet-4-6",
			"anthropic/claude-opus-5",
		]);
		expect(result.applied).toBe(false);
		expect(result.roles).toEqual(current);
		expect(result.missingModels).toContain("anthropic/claude-sonnet-5");
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

	it("requires Luna, Terra, and Sol before changing any OpenAI role", () => {
		const current = { default: "anthropic/claude-sonnet-4-6:high", vision: "google/vision" };
		const result = applySubscriptionProfileRoles("openai-codex", current, [
			"openai-codex/gpt-5.6-luna",
			"openai-codex/gpt-5.6-sol",
		]);

		expect(result.applied).toBe(false);
		expect(result.roles).toEqual(current);
		expect(result.missingModels).toEqual(["openai-codex/gpt-5.6-terra"]);
	});
});
