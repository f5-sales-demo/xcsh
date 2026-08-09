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
			runRoutingClassifier: mockRunner,
		});

		expect(called).toBe(false);
		expect(profile.desiredTier).toBe("utility");
	});

	it("should return early when deterministic complexity is very low or very high", async () => {
		let called = false;
		const mockRunner = async () => {
			called = true;
			return JSON.stringify({ complexityScore: 80, confidence: 0.9 });
		};
		const profileLow = await classifyTaskHybrid({
			prompt: "cat file.txt",
			pool: samplePool,
			profilerMode: "hybrid",
			runRoutingClassifier: mockRunner,
		});
		expect(called).toBe(false); // <=30 doesn't call
		expect(profileLow.desiredTier).toBe("utility");

		const profileHigh = await classifyTaskHybrid({
			prompt: "refactor the session architecture and migrate to new security model",
			pool: samplePool,
			profilerMode: "hybrid",
			runRoutingClassifier: mockRunner,
		});
		expect(called).toBe(false); // >=70 doesn't call
		expect(profileHigh.desiredTier).toBe("frontier");
	});

	it("should call utility model when profilerMode is 'hybrid' and deterministic profile is ambiguous", async () => {
		let called = false;
		const mockRunner = async () => {
			called = true;
			return JSON.stringify({ complexityScore: 80, confidence: 0.95 });
		};

		const profile = await classifyTaskHybrid({
			prompt: "Please review this code for logical errors target", // Ambiguous score -> hits classifier
			pool: samplePool,
			profilerMode: "hybrid",
			runRoutingClassifier: mockRunner,
		});

		expect(called).toBe(true);
		expect(profile.desiredTier).toBe("frontier"); // mock returns 80 -> frontier
	});

	it("should safely handle classifier returning an empty object", async () => {
		const mockRunnerLowConfidence = async () => {
			return JSON.stringify({ complexityScore: 90, confidence: 0.5 });
		};

		const profile = await classifyTaskHybrid({
			prompt: "ambiguous prompt needing review target",
			pool: samplePool,
			profilerMode: "hybrid",
			runRoutingClassifier: mockRunnerLowConfidence,
		});

		expect(profile.desiredTier).toBe("balanced");
	});

	it("should fall back safely to balanced when confidence < 0.75 or output is malformed", async () => {
		const mockRunnerError = async () => {
			throw new Error("Network timeout");
		};

		const profile = await classifyTaskHybrid({
			prompt: "ambiguous prompt needing review target",
			pool: samplePool,
			profilerMode: "hybrid",
			runRoutingClassifier: mockRunnerError,
		});

		expect(profile.desiredTier).toBe("balanced");
		expect(profile.reasons).toContain("classifier_fallback_timeout");
	});

	it("should not allow classifier score to bypass hasImages or priorRejection floors", async () => {
		const mockRunnerUtility = async () => {
			return JSON.stringify({ complexityScore: 10, confidence: 0.9 }); // lowest score
		};

		const profileWithImage = await classifyTaskHybrid({
			prompt: "Describe this image",
			pool: samplePool,
			profilerMode: "hybrid",
			hasImages: true,
			runRoutingClassifier: mockRunnerUtility,
		});

		// hasImages should bump utility to balanced
		expect(profileWithImage.desiredTier).toBe("balanced");

		const profileWithPriorRejection = await classifyTaskHybrid({
			prompt: "Fix the test failure",
			pool: samplePool,
			profilerMode: "hybrid",
			priorRejection: true,
			runRoutingClassifier: mockRunnerUtility,
		});

		// priorRejection should bump to frontier
		expect(profileWithPriorRejection.desiredTier).toBe("frontier");
	});
});
