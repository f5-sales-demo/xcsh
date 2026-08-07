import { describe, expect, it } from "bun:test";
import { classifyTaskHybrid } from "../src/routing/classifier";
import type { RoutingPoolConfig } from "../src/routing/types";

describe("Hybrid Classifier (P04)", () => {
	const samplePool: RoutingPoolConfig = {
		id: "openai/gpt-5.6",
		provider: "openai",
		tiers: {
			utility: "gpt-4o-mini",
			balanced: "gpt-4o",
			frontier: "o3-mini",
		},
	};

	it("should skip classifier network call when profiler mode is 'rules'", async () => {
		let called = false;
		const mockRunner = async () => {
			called = true;
			return JSON.stringify({ complexityScore: 80, confidence: 0.9 });
		};

		const profile = await classifyTaskHybrid({
			prompt: "Add formatting helper",
			pool: samplePool,
			profilerMode: "rules",
			mockClassifierRunner: mockRunner,
		});

		expect(called).toBe(false);
		expect(profile.desiredTier).toBe("balanced");
	});

	it("should call utility model when profilerMode is 'hybrid' and deterministic profile is ambiguous", async () => {
		let called = false;
		const mockRunner = async () => {
			called = true;
			return JSON.stringify({ complexityScore: 85, confidence: 0.95 });
		};

		const profile = await classifyTaskHybrid({
			prompt: "Add a new formatting helper to utils",
			pool: samplePool,
			profilerMode: "hybrid",
			mockClassifierRunner: mockRunner,
		});

		expect(called).toBe(true);
		expect(profile.desiredTier).toBe("frontier");
		expect(profile.confidence).toBe(0.95);
	});

	it("should fall back safely to balanced when confidence < 0.75 or output is malformed", async () => {
		const mockRunnerLowConfidence = async () => {
			return JSON.stringify({ complexityScore: 90, confidence: 0.5 }); // low confidence
		};

		const profile = await classifyTaskHybrid({
			prompt: "Add formatting helper",
			pool: samplePool,
			profilerMode: "hybrid",
			mockClassifierRunner: mockRunnerLowConfidence,
		});

		expect(profile.desiredTier).toBe("balanced");
	});
});
