import { describe, expect, it } from "bun:test";
import { Effort } from "@f5-sales-demo/pi-ai";
import type { ModelBenchmarkTarget } from "./model-matrix-report";
import { analyzeScenarioBenchmarkReport, renderScenarioBenchmarkAnalysis } from "./model-scenario-analysis";
import type { ScenarioBenchmarkReport, ScenarioBenchmarkSample } from "./model-scenario-report";

const fast: ModelBenchmarkTarget = { label: "Fast", selector: "provider/fast" };
const careful: ModelBenchmarkTarget = { label: "Careful", selector: "provider/careful" };
const unavailable: ModelBenchmarkTarget = { label: "Unavailable", selector: "provider/unavailable" };

function sample(
	target: ModelBenchmarkTarget,
	overrides: Partial<ScenarioBenchmarkSample>,
): ScenarioBenchmarkSample {
	return {
		label: target.label,
		selector: target.selector,
		scenarioId: "identity",
		scenarioLabel: "Identity",
		suite: "identity",
		tier: 1,
		requestedThinking: Effort.High,
		effectiveThinking: Effort.High,
		round: 1,
		warmup: false,
		startedAt: "2026-08-02T00:00:00.000Z",
		success: true,
		contractPassed: true,
		contractFailures: [],
		quality: {
			score: 100,
			earned: 100,
			possible: 100,
			visibleWords: 4,
			criteria: [{ id: "answer", label: "Answers", weight: 100, passed: true }],
		},
		response: "A useful measured answer.",
		exitCode: 0,
		timedOut: false,
		eventCount: 4,
		turnCount: 1,
		assistantMessageCount: 1,
		toolCalls: [],
		ttftMs: 100,
		responseDurationMs: 200,
		processDurationMs: 220,
		...overrides,
	};
}

function report(): ScenarioBenchmarkReport {
	return {
		schemaVersion: 3,
		createdAt: "2026-08-02T00:00:00.000Z",
		config: {
			thinkingEfforts: [Effort.Low, Effort.High],
			runs: 2,
			warmups: 0,
			timeoutMs: 1_000,
			failFastProviderError: false,
			order: "rotating-round-robin",
			models: [fast, careful],
			scenarios: [
				{
					id: "identity",
					label: "Identity",
					suite: "identity",
					tier: 1,
					prompt: "Static prompt",
					contract: ["Answers"],
					quality: [
						{ id: "answer", label: "Answers", weight: 90 },
						{ id: "direct", label: "Direct", weight: 10 },
					],
					runtime: { tools: "none", extensions: "none", skills: "none", requiresContext: false },
				},
			],
		},
		warmups: [],
		samples: [
			sample(fast, {
				requestedThinking: Effort.Low,
				effectiveThinking: Effort.Low,
				ttftMs: 400,
				responseDurationMs: 800,
				quality: {
					score: 50,
					earned: 50,
					possible: 100,
					visibleWords: 4,
					criteria: [{ id: "answer", label: "Answers", weight: 100, passed: false }],
				},
			}),
			sample(careful, {
				requestedThinking: Effort.Low,
				effectiveThinking: Effort.Low,
				ttftMs: 100,
				responseDurationMs: 200,
			}),
			sample(fast, { round: 1, ttftMs: 100, responseDurationMs: 200 }),
			sample(careful, { round: 1, ttftMs: 200, responseDurationMs: 400 }),
			sample(fast, { round: 2, ttftMs: 120, responseDurationMs: 220 }),
			sample(careful, {
				round: 2,
				ttftMs: 240,
				responseDurationMs: 440,
				quality: {
					score: 80,
					earned: 80,
					possible: 100,
					visibleWords: 8,
					criteria: [{ id: "direct", label: "Direct", weight: 20, passed: false }],
				},
			}),
		],
		summaries: [],
	};
}

describe("scenario benchmark analysis", () => {
	it("ranks quality and speed independently and publishes the balanced formula", () => {
		const source = report();
		const analysis = analyzeScenarioBenchmarkReport(source);
		const fastModel = analysis.models.find(
			model => model.selector === fast.selector && model.thinking === Effort.High,
		);
		const carefulModel = analysis.models.find(
			model => model.selector === careful.selector && model.thinking === Effort.High,
		);
		const lowLeader = analysis.models.find(model => model.thinking === Effort.Low && model.rank === 1);

		expect(fastModel).toMatchObject({ qualityRank: 1, speedRank: 1, rank: 1, qualityScore: 100, speedScore: 100 });
		expect(carefulModel).toMatchObject({ qualityRank: 2, speedRank: 2, rank: 2, qualityScore: 90, speedScore: 50 });
		expect(lowLeader).toMatchObject({ selector: careful.selector, effectiveThinking: [Effort.Low] });
		expect(
			analysis.scenarios.find(row => row.selector === careful.selector && row.thinking === Effort.High),
		).toMatchObject({
			quality: { mean: 90, min: 80, max: 100 },
			ttftMs: { p50: 220, coefficientOfVariation: 0.091 },
			failedQualityCriteria: [{ id: "direct", failures: 1 }],
		});
		expect(renderScenarioBenchmarkAnalysis(analysis, source)).toContain("60% rubric-scored output quality");
	});

	it("leaves providers with no successful responses explicitly unranked", () => {
		const source = report();
		source.config.models.push(unavailable);
		source.samples.push(
			sample(unavailable, {
				requestedThinking: Effort.Low,
				effectiveThinking: Effort.Low,
				success: false,
				contractPassed: false,
				error: "Provider quota exhausted",
				ttftMs: undefined,
				responseDurationMs: undefined,
			}),
			sample(unavailable, {
				success: false,
				contractPassed: false,
				error: "Provider quota exhausted",
				ttftMs: undefined,
				responseDurationMs: undefined,
			}),
		);

		const analysis = analyzeScenarioBenchmarkReport(source);
		const unavailableRows = analysis.models.filter(model => model.selector === unavailable.selector);

		expect(unavailableRows).toHaveLength(2);
		expect(unavailableRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					availability: "unavailable",
					rank: null,
					qualityRank: null,
					speedRank: null,
				}),
			]),
		);
		expect(renderScenarioBenchmarkAnalysis(analysis, source)).toContain("unavailable");
	});

	it("does not imply tail-latency confidence for a one-run matrix", () => {
		const source = report();
		source.config.runs = 1;
		const rendered = renderScenarioBenchmarkAnalysis(analyzeScenarioBenchmarkReport(source), source);

		expect(rendered).toContain("1 measured run per cell is exploratory");
		expect(rendered).toContain("p50 and p95 are the same observation");
	});
});
