import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "bun:test";
import { Effort } from "@f5-sales-demo/pi-ai";
import {
	defaultModelBenchmarkOutputFile,
	displayModelBenchmarkOutputFile,
} from "./model-benchmark-paths";
import type { ModelBenchmarkTarget } from "./model-matrix-report";
import { MODEL_BENCHMARK_SCENARIOS, selectModelBenchmarkScenarios } from "./model-scenario-library";
import {
	buildScenarioBenchmarkSample,
	regradeScenarioBenchmarkReport,
	summarizeScenarioBenchmarks,
	type ScenarioBenchmarkReport,
} from "./model-scenario-report";

const target: ModelBenchmarkTarget = { label: "Example", selector: "provider/model" };
const readScenario = MODEL_BENCHMARK_SCENARIOS.find(scenario => scenario.id === "read-tool")!;

describe("model scenario library", () => {
	it("stores default reports outside the repository without displaying the home path", () => {
		const outputFile = defaultModelBenchmarkOutputFile("model-scenarios", "2026-08-03T21:40:26.190Z", 42);
		expect(outputFile).toBe(
			path.join(os.homedir(), ".xcsh", "benchmarks", "model-scenarios-2026-08-03T21-40-26.190Z-42.json"),
		);
		expect(displayModelBenchmarkOutputFile(outputFile)).toBe(
			path.join("~", ".xcsh", "benchmarks", "model-scenarios-2026-08-03T21-40-26.190Z-42.json"),
		);
		expect(defaultModelBenchmarkOutputFile("model-scenarios", "2026-08-03T21:40:26.190Z", 43)).not.toBe(
			outputFile,
		);
	});

	it("preserves the two initial comparison prompts verbatim", () => {
		const assistantIdentity = MODEL_BENCHMARK_SCENARIOS.find(scenario => scenario.id === "assistant-identity");
		expect(assistantIdentity?.prompt).toBe(
			"Who are you and what are you good at ?",
		);
		expect(assistantIdentity?.contract.requiredTools).toBeUndefined();
		expect(assistantIdentity?.runtime.tools).toEqual(["read"]);
		expect(MODEL_BENCHMARK_SCENARIOS.find(scenario => scenario.id === "user-assistance")?.prompt).toBe(
			"Who am I and how can you help me ?",
		);
	});

	it("selects progressively more capable scenarios by tier", () => {
		const throughTools = selectModelBenchmarkScenarios({ suite: "all", maxTier: 2 });
		expect(throughTools.map(scenario => scenario.id)).toEqual([
			"ping",
			"assistant-identity",
			"user-assistance",
			"read-tool",
		]);
		expect(throughTools.every(scenario => scenario.tier <= 2)).toBe(true);
	});

	it("grades identity output against the exact selected context", () => {
		const [scenario] = selectModelBenchmarkScenarios({ ids: ["user-assistance"], contextName: "example.corp" });
		const criterion = scenario.quality.find(candidate => candidate.id === "active-context");
		expect(criterion?.responsePattern?.test("Tenant example.corp is active")).toBe(true);
		expect(criterion?.responsePattern?.test("Tenant exampleXcorp is active")).toBe(false);
	});
});

describe("model scenario event contracts", () => {
	it("measures the tool boundary and passes an exact tool-use contract", () => {
		const sample = buildScenarioBenchmarkSample({
			target,
			scenario: readScenario,
			round: 1,
			warmup: false,
			startedAt: "2026-08-02T00:00:00.000Z",
			processDurationMs: 1_000,
			exitCode: 0,
			timedOut: false,
			stderr: "",
			stdoutErrors: [],
			events: [
				{ elapsedMs: 10, event: { type: "session", provider: "provider", model: "model" } },
				{ elapsedMs: 100, event: { type: "message_start", message: { role: "user" } } },
				{
					elapsedMs: 300,
					event: { type: "message_end", message: { role: "assistant", ttft: 150, duration: 190 } },
				},
				{
					elapsedMs: 320,
					event: {
						type: "tool_execution_start",
						toolCallId: "tool-1",
						toolName: "read",
						args: { path: "packages/coding-agent/bench/fixtures/tool-probe.txt" },
					},
				},
				{
					elapsedMs: 370,
					event: { type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", result: {} },
				},
				{
					elapsedMs: 600,
					event: {
						type: "message_update",
						assistantMessageEvent: { type: "text_delta", delta: "TOOL_PROBE_OK_7F3C" },
					},
				},
				{
					elapsedMs: 650,
					event: {
						type: "message_end",
						message: {
							role: "assistant",
							provider: "provider",
							model: "model",
							stopReason: "stop",
							ttft: 220,
							duration: 300,
							usage: {
								input: 10,
								output: 2,
								cacheRead: 3,
								cacheWrite: 0,
								totalTokens: 15,
								cost: { total: 0.01 },
							},
						},
					},
				},
				{ elapsedMs: 660, event: { type: "turn_end" } },
			],
		});

		expect(sample).toMatchObject({
			success: true,
			contractPassed: true,
			quality: { score: 100, earned: 100, possible: 100, visibleWords: 1 },
			response: "TOOL_PROBE_OK_7F3C",
			timeToFirstToolMs: 220,
			totalToolDurationMs: 50,
			responseDurationMs: 550,
			assistantMessageCount: 2,
			turnCount: 1,
			outputTokensPerSecond: 4.082,
			usage: { input: 10, output: 2, cacheRead: 3 },
		});
		expect(sample.toolCalls).toEqual([
			{
				id: "tool-1",
				name: "read",
				args: { path: "packages/coding-agent/bench/fixtures/tool-probe.txt" },
				startedAtMs: 320,
				durationMs: 50,
				isError: false,
				isWarning: false,
			},
		]);
	});

	it("fails the contract for an unexpected or failed tool without hiding transport success", () => {
		const sample = buildScenarioBenchmarkSample({
			target,
			scenario: readScenario,
			round: 1,
			warmup: false,
			startedAt: "2026-08-02T00:00:00.000Z",
			processDurationMs: 500,
			exitCode: 0,
			timedOut: false,
			stderr: "",
			stdoutErrors: [],
			events: [
				{ elapsedMs: 10, event: { type: "session", provider: "provider", model: "model" } },
				{ elapsedMs: 20, event: { type: "message_start", message: { role: "user" } } },
				{
					elapsedMs: 30,
					event: { type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: {} },
				},
				{
					elapsedMs: 40,
					event: { type: "tool_execution_end", toolCallId: "tool-1", toolName: "bash", isError: true },
				},
				{
					elapsedMs: 50,
					event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "wrong" } },
				},
				{
					elapsedMs: 60,
					event: { type: "message_end", message: { role: "assistant", provider: "provider", model: "model" } },
				},
			],
		});

		expect(sample.success).toBe(true);
		expect(sample.contractPassed).toBe(false);
		expect(sample.contractFailures).toEqual(
			expect.arrayContaining([
				"response did not exactly match \"TOOL_PROBE_OK_7F3C\"",
				expect.stringContaining("tool read matching path="),
				"unexpected tools called: bash",
				"tool execution failed: bash",
			]),
		);
	});

	it("surfaces provider error completions as transport failures", () => {
		const sample = buildScenarioBenchmarkSample({
			target,
			scenario: readScenario,
			round: 1,
			warmup: false,
			startedAt: "2026-08-02T00:00:00.000Z",
			processDurationMs: 500,
			exitCode: 0,
			timedOut: false,
			stderr: "",
			stdoutErrors: [],
			events: [
				{ elapsedMs: 10, event: { type: "session", provider: "provider", model: "model" } },
				{ elapsedMs: 20, event: { type: "message_start", message: { role: "user" } } },
				{
					elapsedMs: 30,
					event: {
						type: "message_end",
						message: {
							role: "assistant",
							provider: "provider",
							model: "model",
							stopReason: "error",
							errorMessage: "Provider quota exhausted",
						},
					},
				},
			],
		});

		expect(sample.success).toBe(false);
		expect(sample.error).toContain("Provider quota exhausted");
		expect(sample.quality.score).toBe(0);
		expect(sample.quality.criteria.every(criterion => !criterion.passed)).toBe(true);
	});

	it("aggregates transport and contract rates independently", () => {
		const passing = buildScenarioBenchmarkSample({
			target,
			scenario: readScenario,
			thinking: Effort.High,
			round: 1,
			warmup: false,
			startedAt: "2026-08-02T00:00:00.000Z",
			processDurationMs: 100,
			exitCode: 0,
			timedOut: false,
			stderr: "",
			stdoutErrors: [],
			events: [
				{ elapsedMs: 1, event: { type: "session", provider: "provider", model: "model", thinking: "high" } },
				{ elapsedMs: 2, event: { type: "message_start", message: { role: "user" } } },
				{
					elapsedMs: 3,
					event: {
						type: "tool_execution_start",
						toolCallId: "t",
						toolName: "read",
						args: { path: "packages/coding-agent/bench/fixtures/tool-probe.txt" },
					},
				},
				{ elapsedMs: 4, event: { type: "tool_execution_end", toolCallId: "t", toolName: "read" } },
				{
					elapsedMs: 5,
					event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "TOOL_PROBE_OK_7F3C" } },
				},
				{
					elapsedMs: 6,
					event: { type: "message_end", message: { role: "assistant", provider: "provider", model: "model" } },
				},
			],
		});
		const failing = { ...passing, round: 2, contractPassed: false };
		const summary = summarizeScenarioBenchmarks([readScenario], [target], [Effort.High], [passing, failing])[0];

		expect(summary).toMatchObject({
			samples: 2,
			successes: 2,
			contractPasses: 1,
			successRate: 1,
			contractPassRate: 0.5,
			qualityScore: { min: 100, p50: 100, p95: 100, max: 100 },
		});
	});

	it("rejects a read call that spends the permitted tool call on the wrong file", () => {
		const sample = buildScenarioBenchmarkSample({
			target,
			scenario: readScenario,
			round: 1,
			warmup: false,
			startedAt: "2026-08-02T00:00:00.000Z",
			processDurationMs: 100,
			exitCode: 0,
			timedOut: false,
			stderr: "",
			stdoutErrors: [],
			events: [
				{ elapsedMs: 1, event: { type: "session", provider: "provider", model: "model" } },
				{ elapsedMs: 2, event: { type: "message_start", message: { role: "user" } } },
				{
					elapsedMs: 3,
					event: {
						type: "tool_execution_start",
						toolCallId: "t",
						toolName: "read",
						args: { path: "memory://root/memory_summary.md" },
					},
				},
				{ elapsedMs: 4, event: { type: "tool_execution_end", toolCallId: "t", toolName: "read" } },
				{
					elapsedMs: 5,
					event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "[blocked]" } },
				},
				{
					elapsedMs: 6,
					event: { type: "message_end", message: { role: "assistant", provider: "provider", model: "model" } },
				},
			],
		});

		expect(sample.contractFailures).toEqual(
			expect.arrayContaining([
				'response did not exactly match "TOOL_PROBE_OK_7F3C"',
				expect.stringContaining("tool read matching path="),
			]),
		);
		expect(sample.quality.score).toBe(0);
	});

	it("rejects extra calls that reuse an allowed exclusive tool name", () => {
		const sample = buildScenarioBenchmarkSample({
			target,
			scenario: readScenario,
			round: 1,
			warmup: false,
			startedAt: "2026-08-02T00:00:00.000Z",
			processDurationMs: 100,
			exitCode: 0,
			timedOut: false,
			stderr: "",
			stdoutErrors: [],
			events: [
				{ elapsedMs: 1, event: { type: "message_start", message: { role: "user" } } },
				{
					elapsedMs: 2,
					event: {
						type: "tool_execution_start",
						toolCallId: "memory",
						toolName: "read",
						args: { path: "memory://root/memory_summary.md" },
					},
				},
				{ elapsedMs: 3, event: { type: "tool_execution_end", toolCallId: "memory", toolName: "read" } },
				{
					elapsedMs: 4,
					event: {
						type: "tool_execution_start",
						toolCallId: "probe",
						toolName: "read",
						args: { path: "packages/coding-agent/bench/fixtures/tool-probe.txt" },
					},
				},
				{ elapsedMs: 5, event: { type: "tool_execution_end", toolCallId: "probe", toolName: "read" } },
				{
					elapsedMs: 6,
					event: {
						type: "message_update",
						assistantMessageEvent: { type: "text_delta", delta: "TOOL_PROBE_OK_7F3C" },
					},
				},
				{ elapsedMs: 7, event: { type: "message_end", message: { role: "assistant" } } },
			],
		});

		expect(sample.contractFailures).toContain("tool call count was 2, expected exactly 1");
		expect(sample.quality.score).toBe(0);
	});

	it("grades the actual open-ended response against the published rubric", () => {
		const [scenario] = selectModelBenchmarkScenarios({ ids: ["user-assistance"], contextName: "example-corp" });
		const sample = buildScenarioBenchmarkSample({
			target,
			scenario,
			round: 1,
			warmup: false,
			startedAt: "2026-08-02T00:00:00.000Z",
			processDurationMs: 100,
			exitCode: 0,
			timedOut: false,
			stderr: "",
			stdoutErrors: [],
			events: [
				{ elapsedMs: 1, event: { type: "session", provider: "provider", model: "model" } },
				{ elapsedMs: 2, event: { type: "message_start", message: { role: "user" } } },
				{
					elapsedMs: 3,
					event: {
						type: "message_update",
						assistantMessageEvent: {
							type: "text_delta",
							delta: "Based on this session, you are an F5 sales engineer in example-corp. I can help with F5 XC WAAP, network security, MEDDPICC discovery, and Terraform diagrams. I verify claims.",
						},
					},
				},
				{
					elapsedMs: 4,
					event: { type: "message_end", message: { role: "assistant", provider: "provider", model: "model" } },
				},
			],
		});

		expect(sample.quality.score).toBe(100);
		expect(sample.quality.criteria.every(criterion => criterion.passed)).toBe(true);
	});

	it("regrades stored raw responses and tool traces without changing timing data", () => {
		const original = buildScenarioBenchmarkSample({
			target,
			scenario: readScenario,
			thinking: Effort.High,
			round: 1,
			warmup: false,
			startedAt: "2026-08-02T00:00:00.000Z",
			processDurationMs: 100,
			exitCode: 0,
			timedOut: false,
			stderr: "",
			stdoutErrors: [],
			events: [
				{ elapsedMs: 1, event: { type: "session", provider: "provider", model: "model", thinking: "high" } },
				{ elapsedMs: 2, event: { type: "message_start", message: { role: "user" } } },
				{
					elapsedMs: 3,
					event: {
						type: "tool_execution_start",
						toolCallId: "t",
						toolName: "read",
						args: { path: "packages/coding-agent/bench/fixtures/tool-probe.txt" },
					},
				},
				{ elapsedMs: 4, event: { type: "tool_execution_end", toolCallId: "t", toolName: "read" } },
				{
					elapsedMs: 5,
					event: {
						type: "message_update",
						assistantMessageEvent: { type: "text_delta", delta: "TOOL_PROBE_OK_7F3C" },
					},
				},
				{
					elapsedMs: 6,
					event: { type: "message_end", message: { role: "assistant", provider: "provider", model: "model" } },
				},
			],
		});
		const stale = { ...original, contractPassed: false, contractFailures: ["stale"], ttftMs: 321 };
		const report: ScenarioBenchmarkReport = {
			schemaVersion: 3,
			createdAt: "2026-08-02T00:00:00.000Z",
			config: {
				thinkingEfforts: [Effort.High],
				runs: 1,
				warmups: 0,
				timeoutMs: 1_000,
				failFastProviderError: false,
				order: "rotating-round-robin",
				models: [target],
				scenarios: [
					{
						id: readScenario.id,
						label: readScenario.label,
						suite: readScenario.suite,
						tier: readScenario.tier,
						prompt: readScenario.prompt,
						contract: ["stale"],
						quality: [],
						runtime: readScenario.runtime,
					},
				],
			},
			warmups: [],
			samples: [stale],
			summaries: [],
		};

		const reevaluated = regradeScenarioBenchmarkReport(report, [readScenario]);
		expect(reevaluated.samples[0]).toMatchObject({ contractPassed: true, contractFailures: [], ttftMs: 321 });
		expect(reevaluated.summaries[0]).toMatchObject({ contractPassRate: 1, qualityScore: { p50: 100 } });
	});
});
