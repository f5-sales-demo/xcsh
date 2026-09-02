import { describe, expect, it } from "bun:test";
import { parseContextBenchmarkArgs } from "./context";
import {
	sanitizeContextBenchmarkReport,
	summarizeContextBenchmarks,
	type ContextBenchmarkSample,
} from "./context-report";

describe("context benchmark CLI and aggregation", () => {
	it("parses profile, model, scenario, runs, and offline operation", () => {
		const options = parseContextBenchmarkArgs([
			"--profile",
			"progressive",
			"--model",
			"google/gemini-test",
			"--scenario",
			"pong",
			"--runs",
			"2",
			"--offline-only",
		]);
		expect(options.profiles).toEqual(["progressive"]);
		expect(options.models).toEqual(["google/gemini-test"]);
		expect(options.scenarios).toEqual(["pong"]);
		expect(options.runs).toBe(2);
		expect(options.offlineOnly).toBe(true);
	});

	it("aggregates provider prompt tokens without content fields", () => {
		const sample = {
			profile: "progressive",
			model: "google/gemini-test",
			scenario: "pong",
			round: 1,
			warmup: false,
			skipped: false,
			contractPassed: true,
			durationMs: 10,
			turns: 1,
			toolCalls: 0,
			discoveryCalls: 0,
			mutatingToolCalls: 0,
			deferredContextAvoidedBytes: 100,
			providerCalls: [{ providerPromptTokens: 24000, windowPercentage: 2.4 }],
			static: { systemPromptBytes: 12000, initialToolBytes: 15000, deferredToolBytes: 30000 },
		} as ContextBenchmarkSample;
		const summaries = summarizeContextBenchmarks([sample]);
		expect(summaries[0]?.medianPromptTokens).toBe(24000);
		expect(JSON.stringify(summaries)).not.toContain("promptText");
	});

	it("projects reports onto numeric and safe-label fields", () => {
		const sample = {
			profile: "progressive",
			model: "google/gemini-test",
			scenario: "pong",
			round: 0,
			warmup: false,
			skipped: false,
			contractPassed: true,
			durationMs: 10,
			turns: 1,
			toolCalls: 0,
			discoveryCalls: 0,
			mutatingToolCalls: 0,
			deferredContextAvoidedBytes: 100,
			providerCalls: [],
			static: { systemPromptBytes: 100, initialToolBytes: 100, deferredToolBytes: 100 },
			promptText: "must-not-survive",
		} as ContextBenchmarkSample & { promptText: string };
		const sanitized = sanitizeContextBenchmarkReport({
			schemaVersion: 1,
			createdAt: "2026-09-01T00:00:00.000Z",
			offlineOnly: true,
			samples: [sample],
			summaries: [],
		});
		expect(JSON.stringify(sanitized)).not.toContain("must-not-survive");
	});
});
