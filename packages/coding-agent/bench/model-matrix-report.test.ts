import { describe, expect, it } from "bun:test";
import {
	buildModelBenchmarkSample,
	type ModelBenchmarkSample,
	type ModelBenchmarkTarget,
	summarizeModelBenchmarks,
} from "./model-matrix-report";

const target: ModelBenchmarkTarget = {
	label: "Example",
	selector: "provider/model",
};

describe("live model benchmark event parsing", () => {
	it("measures TTFT from the user prompt event to the first non-empty text delta", () => {
		const sample = buildModelBenchmarkSample({
			target,
			round: 1,
			warmup: false,
			startedAt: "2026-08-02T00:00:00.000Z",
			processDurationMs: 1_800,
			exitCode: 0,
			timedOut: false,
			stderr: "",
			stdoutErrors: [],
			expectedResponse: "PONG",
			events: [
				{ elapsedMs: 100, event: { type: "session", provider: "provider", model: "model" } },
				{ elapsedMs: 400, event: { type: "message_start", message: { role: "user" } } },
				{
					elapsedMs: 1_200,
					event: {
						type: "message_update",
						assistantMessageEvent: { type: "text_delta", delta: "" },
					},
				},
				{
					elapsedMs: 1_400,
					event: {
						type: "message_update",
						assistantMessageEvent: { type: "text_delta", delta: "P" },
					},
				},
				{
					elapsedMs: 1_450,
					event: {
						type: "message_update",
						assistantMessageEvent: { type: "text_delta", delta: "ONG" },
					},
				},
				{
					elapsedMs: 1_600,
					event: {
						type: "message_end",
						message: {
							role: "assistant",
							provider: "provider",
							model: "model",
							stopReason: "stop",
							ttft: 1_000,
							duration: 1_200,
							usage: {
								input: 20,
								output: 5,
								cacheRead: 3,
								cacheWrite: 4,
								totalTokens: 32,
								cost: { total: 0.25 },
							},
						},
					},
				},
			],
		});

		expect(sample).toMatchObject({
			success: true,
			responseExact: true,
			response: "PONG",
			startupMs: 400,
			ttftMs: 1_000,
			startupInclusiveTtftMs: 1_400,
			responseDurationMs: 1_200,
			providerReportedTtftMs: 1_000,
			providerReportedDurationMs: 1_200,
			outputTokensPerSecond: 4.167,
			usage: { input: 20, output: 5, cacheRead: 3, cacheWrite: 4, totalTokens: 32, costTotal: 0.25 },
		});
	});

	it("rejects a successful process that silently resolves a different model", () => {
		const sample = buildModelBenchmarkSample({
			target,
			round: 1,
			warmup: false,
			startedAt: "2026-08-02T00:00:00.000Z",
			processDurationMs: 500,
			exitCode: 0,
			timedOut: false,
			stderr: "",
			stdoutErrors: [],
			expectedResponse: "PONG",
			events: [
				{ elapsedMs: 10, event: { type: "session", provider: "other", model: "model" } },
				{ elapsedMs: 20, event: { type: "message_start", message: { role: "user" } } },
				{
					elapsedMs: 30,
					event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "PONG" } },
				},
				{
					elapsedMs: 40,
					event: { type: "message_end", message: { role: "assistant", provider: "other", model: "model" } },
				},
			],
		});

		expect(sample.success).toBe(false);
		expect(sample.error).toContain("resolved other/model instead of provider/model");
	});
});

describe("live model benchmark aggregation", () => {
	it("reports medians and nearest-rank p95 from successful measured samples only", () => {
		const samples = [100, 200, 400].map(
			(ttftMs, index): ModelBenchmarkSample => ({
				label: target.label,
				selector: target.selector,
				round: index + 1,
				warmup: false,
				startedAt: "2026-08-02T00:00:00.000Z",
				success: true,
				responseExact: index !== 2,
				response: index !== 2 ? "PONG" : "pong",
				exitCode: 0,
				timedOut: false,
				eventCount: 8,
				ttftMs,
				processDurationMs: ttftMs + 500,
			}),
		);
		const summaries = summarizeModelBenchmarks([target], samples);

		expect(summaries[0]).toMatchObject({
			samples: 3,
			successes: 3,
			exactResponses: 2,
			successRate: 1,
			exactResponseRate: 0.667,
			latencyMs: {
				ttft: { min: 100, p50: 200, p95: 400, max: 400 },
			},
		});
	});
});
