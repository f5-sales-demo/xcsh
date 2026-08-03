/** Live tiered xcsh scenario benchmark across the configured model matrix. */
import * as path from "node:path";
import { Effort } from "@f5-sales-demo/pi-ai";
import { readLines, readStreamCappedText } from "@f5-sales-demo/pi-utils";
import {
	defaultModelBenchmarkOutputFile,
	displayModelBenchmarkOutputFile,
} from "./model-benchmark-paths";
import type { ModelBenchmarkTarget, TimedJsonEvent } from "./model-matrix-report";
import {
	MODEL_BENCHMARK_PLUGIN_DIR,
	type ModelBenchmarkScenario,
	type ModelScenarioSuite,
	selectModelBenchmarkScenarios,
} from "./model-scenario-library";
import {
	buildScenarioBenchmarkSample,
	describeScenarioContract,
	type ScenarioBenchmarkReport,
	type ScenarioBenchmarkSample,
	type ScenarioBenchmarkSummary,
	summarizeScenarioBenchmarks,
} from "./model-scenario-report";

const CLI = path.join(import.meta.dir, "../src/cli.ts");
const REPO_ROOT = path.join(import.meta.dir, "../../..");
const DEFAULT_TARGETS: ModelBenchmarkTarget[] = [
	{ label: "Gemini 3.6 Flash", selector: "google-vertex/gemini-3.6-flash" },
	{ label: "GPT-5.6 Sol", selector: "litellm/gpt-5.6-sol" },
	{ label: "Claude Opus 5", selector: "anthropic/claude-opus-5" },
];

interface CliOptions {
	runs: number;
	warmups: number;
	timeoutMs: number;
	outFile?: string;
	contextName?: string;
	suite: ModelScenarioSuite | "all";
	maxTier?: number;
	scenarioIds: string[];
	targets: ModelBenchmarkTarget[];
	thinkingEfforts: Effort[];
	failFastProviderError: boolean;
}

interface CapturedEvents {
	events: TimedJsonEvent[];
	errors: string[];
}

interface ProcessOutcome {
	timedOut: boolean;
	exitCode: number;
}

function readValue(args: string[], index: number, name: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
	return value;
}

function integer(value: string, name: string, allowZero = false): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
		throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
	}
	return parsed;
}

function parseTarget(value: string): ModelBenchmarkTarget {
	const equals = value.indexOf("=");
	const label = equals > 0 ? value.slice(0, equals).trim() : value.trim();
	const selector = equals > 0 ? value.slice(equals + 1).trim() : value.trim();
	if (!label || !selector.includes("/")) {
		throw new Error("--model must be a provider/model selector or label=provider/model");
	}
	return { label, selector };
}

function parseSuite(value: string): ModelScenarioSuite | "all" {
	if (["ping", "identity", "tools", "plugins", "authenticated", "integrations", "all"].includes(value)) {
		return value as ModelScenarioSuite | "all";
	}
	throw new Error(`Unknown suite: ${value}`);
}

export const BENCHMARK_THINKING_EFFORTS: readonly Effort[] = [
	Effort.Low,
	Effort.Medium,
	Effort.High,
	Effort.XHigh,
	Effort.Max,
];

function parseThinking(value: string): Effort | "all" {
	const normalized = value === "med" ? "medium" : value;
	if (normalized === "all") return normalized;
	if (BENCHMARK_THINKING_EFFORTS.includes(normalized as Effort)) return normalized as Effort;
	throw new Error(`Unknown thinking effort: ${value}`);
}

function parseArgs(args: string[]): CliOptions {
	let runs = 3;
	let warmups = 1;
	let timeoutMs = 120_000;
	let suite: ModelScenarioSuite | "all" = "identity";
	let maxTier: number | undefined;
	let contextName: string | undefined;
	let thinkingEfforts: Effort[] = [];
	let allThinkingEfforts = false;
	let failFastProviderError = false;
	let outFile: string | undefined;
	const scenarioIds: string[] = [];
	const targets: ModelBenchmarkTarget[] = [];
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--runs") {
			runs = integer(readValue(args, index, argument), argument);
			index++;
		} else if (argument === "--warmups") {
			warmups = integer(readValue(args, index, argument), argument, true);
			index++;
		} else if (argument === "--timeout-ms") {
			timeoutMs = integer(readValue(args, index, argument), argument);
			index++;
		} else if (argument === "--tier") {
			maxTier = integer(readValue(args, index, argument), argument, true);
			if (maxTier > 5) throw new Error("--tier must be between 0 and 5");
			index++;
		} else if (argument === "--suite") {
			suite = parseSuite(readValue(args, index, argument));
			index++;
		} else if (argument === "--thinking") {
			const thinking = parseThinking(readValue(args, index, argument));
			if (thinking === "all") {
				allThinkingEfforts = true;
			} else if (!thinkingEfforts.includes(thinking)) {
				thinkingEfforts.push(thinking);
			}
			index++;
		} else if (argument === "--fail-fast-provider-error") {
			failFastProviderError = true;
		} else if (argument === "--scenario") {
			scenarioIds.push(readValue(args, index, argument));
			index++;
		} else if (argument === "--context") {
			contextName = readValue(args, index, argument);
			index++;
		} else if (argument === "--out") {
			outFile = readValue(args, index, argument);
			index++;
		} else if (argument === "--model") {
			targets.push(parseTarget(readValue(args, index, argument)));
			index++;
		} else if (argument === "--help" || argument === "-h") {
			process.stdout.write(
				"Usage: bun bench:model-scenarios [--suite identity|tools|plugins|authenticated|integrations|all] [--tier 0-5] [--thinking low|medium|high|xhigh|max|all] [--scenario ID] [--context NAME] [--runs N] [--warmups N] [--fail-fast-provider-error] [--model LABEL=PROVIDER/MODEL] [--out FILE]\n",
			);
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	if (allThinkingEfforts && thinkingEfforts.length > 0) {
		throw new Error("--thinking all cannot be combined with an individual effort");
	}
	return {
		runs,
		warmups,
		timeoutMs,
		outFile,
		contextName,
		suite,
		maxTier,
		scenarioIds,
		targets: targets.length > 0 ? targets : DEFAULT_TARGETS,
		thinkingEfforts: allThinkingEfforts
			? [...BENCHMARK_THINKING_EFFORTS]
			: thinkingEfforts.length > 0
				? thinkingEfforts
				: [Effort.High],
		failFastProviderError,
	};
}

function elapsedMs(startNs: number): number {
	return (Bun.nanoseconds() - startNs) / 1e6;
}

async function captureEvents(
	stream: ReadableStream<Uint8Array>,
	startNs: number,
	onEvent?: (event: unknown) => void,
): Promise<CapturedEvents> {
	const events: TimedJsonEvent[] = [];
	const errors: string[] = [];
	let lineNumber = 0;
	for await (const line of readLines(stream)) {
		lineNumber++;
		const parsed = Bun.JSONL.parse(line);
		if (parsed.length === 0) {
			errors.push(`stdout line ${lineNumber} was not a JSON event`);
			continue;
		}
		const receivedAt = elapsedMs(startNs);
		for (const event of parsed) {
			events.push({ elapsedMs: receivedAt, event });
			onEvent?.(event);
		}
	}
	return { events, errors };
}

async function waitForExit(child: Bun.Subprocess, timeoutMs: number): Promise<ProcessOutcome> {
	const { promise, resolve } = Promise.withResolvers<ProcessOutcome>();
	const timer: NodeJS.Timeout = setTimeout(() => resolve({ timedOut: true, exitCode: 124 }), timeoutMs);
	void child.exited.then(exitCode => resolve({ timedOut: false, exitCode }));
	const outcome = await promise;
	clearTimeout(timer);
	return outcome;
}

async function terminateProcess(child: Bun.Subprocess): Promise<number> {
	child.kill();
	const graceful = await waitForExit(child, 5_000);
	if (!graceful.timedOut) return graceful.exitCode;
	child.kill("SIGKILL");
	return child.exited;
}

function scenarioArgs(
	scenario: ModelBenchmarkScenario,
	target: ModelBenchmarkTarget,
	contextName: string | undefined,
	thinking: Effort,
): string[] {
	const args = [
		process.execPath,
		CLI,
		"--mode",
		"json",
		"--no-session",
		"--no-memories",
		"--no-mcp",
		"--no-lsp",
		"--no-rules",
		"--no-title",
		"--thinking",
		thinking,
		"--model",
		target.selector,
	];
	if (contextName) args.push("--context", contextName);
	if (scenario.runtime.tools === "none") {
		args.push("--no-tools");
	} else if (Array.isArray(scenario.runtime.tools)) {
		args.push("--no-tools", "--tools", scenario.runtime.tools.join(","));
	}
	if (scenario.runtime.extensions === "none") {
		args.push("--no-extensions");
	} else if (scenario.runtime.extensions === "plugin") {
		args.push("--plugin-dir", MODEL_BENCHMARK_PLUGIN_DIR);
	}
	if (scenario.runtime.skills === "none") {
		args.push("--no-skills");
	} else {
		args.push("--skills", scenario.runtime.skills.join(","));
	}
	args.push(scenario.prompt);
	return args;
}

async function runSample(
	scenario: ModelBenchmarkScenario,
	target: ModelBenchmarkTarget,
	contextName: string | undefined,
	thinking: Effort,
	round: number,
	warmup: boolean,
	timeoutMs: number,
	failFastProviderError: boolean,
): Promise<ScenarioBenchmarkSample> {
	const startedAt = new Date().toISOString();
	const startNs = Bun.nanoseconds();
	const child = Bun.spawn(scenarioArgs(scenario, target, contextName, thinking), {
		cwd: REPO_ROOT,
		env: process.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdoutPromise = captureEvents(child.stdout as ReadableStream<Uint8Array>, startNs, event => {
		if (
			failFastProviderError &&
			typeof event === "object" &&
			event !== null &&
			Reflect.get(event, "type") === "auto_retry_start"
		) {
			child.kill();
		}
	}).catch(error => ({
		events: [],
		errors: [error instanceof Error ? error.message : String(error)],
	}));
	const stderrPromise = readStreamCappedText(child.stderr as ReadableStream<Uint8Array>, {
		maxBytes: 1024 * 1024,
		source: `${scenario.id}:${target.selector}`,
	}).catch(error => (error instanceof Error ? error.message : String(error)));
	const outcome = await waitForExit(child, timeoutMs);
	const exitCode = outcome.timedOut ? await terminateProcess(child) : outcome.exitCode;
	const [captured, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
	return buildScenarioBenchmarkSample({
		target,
		scenario,
		thinking,
		contextName,
		round,
		warmup,
		startedAt,
		processDurationMs: elapsedMs(startNs),
		exitCode,
		timedOut: outcome.timedOut,
		stderr,
		stdoutErrors: captured.errors,
		events: captured.events,
	});
}

function rotatedTargets(targets: ModelBenchmarkTarget[], offset: number): ModelBenchmarkTarget[] {
	const normalized = offset % targets.length;
	return [...targets.slice(normalized), ...targets.slice(0, normalized)];
}

function formatNumber(value: number | undefined, suffix = ""): string {
	return value === undefined ? "-" : `${value.toFixed(1)}${suffix}`;
}

function printProgress(sample: ScenarioBenchmarkSample): void {
	const status = sample.success && sample.contractPassed ? "ok" : "FAIL";
	process.stdout.write(
		`  ${status.padEnd(4)} effort=${sample.requestedThinking ?? "-"}->${sample.effectiveThinking ?? "-"} quality=${formatNumber(sample.quality.score)} ttft=${formatNumber(sample.ttftMs, "ms")} tool=${formatNumber(sample.timeToFirstToolMs, "ms")} total=${formatNumber(sample.responseDurationMs, "ms")} calls=${sample.toolCalls.length}\n`,
	);
	if (sample.error) process.stdout.write(`       ${sample.error}\n`);
	for (const failure of sample.contractFailures) process.stdout.write(`       ${failure}\n`);
}

function printSummary(summaries: ScenarioBenchmarkSummary[]): void {
	const rows = summaries.map(summary => ({
		scenario: summary.scenarioId,
		effort: summary.thinking,
		model: summary.label,
		ok: `${summary.successes}/${summary.samples}`,
		contract: `${summary.contractPasses}/${summary.samples}`,
		quality: formatNumber(summary.qualityScore?.p50),
		ttft: formatNumber(summary.latencyMs.ttft?.p50),
		tool: formatNumber(summary.latencyMs.timeToFirstTool?.p50),
		total: formatNumber(summary.latencyMs.response?.p50),
	}));
	const header = ["scenario", "effort", "model", "ok", "contract", "quality", "ttft p50", "tool p50", "total p50"];
	const widths = header.map((value, index) =>
		Math.max(value.length, ...rows.map(row => Object.values(row)[index]?.length ?? 0)),
	);
	const line = (values: string[]): string => values.map((value, index) => value.padEnd(widths[index])).join("  ");
	process.stdout.write(`\n${line(header)}\n${line(widths.map(width => "-".repeat(width)))}\n`);
	for (const row of rows) process.stdout.write(`${line(Object.values(row))}\n`);
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const scenarios = selectModelBenchmarkScenarios({
		suite: options.scenarioIds.length > 0 ? undefined : options.suite,
		ids: options.scenarioIds,
		maxTier: options.maxTier,
		contextName: options.contextName,
	});
	const contextRequired = scenarios.some(scenario => scenario.runtime.requiresContext);
	if (contextRequired && !options.contextName) {
		throw new Error("Selected scenarios require --context NAME");
	}

	const createdAt = new Date().toISOString();
	const warmupSamples: ScenarioBenchmarkSample[] = [];
	const samples: ScenarioBenchmarkSample[] = [];
	const totalRounds = options.warmups + options.runs;
	for (let overallRound = 0; overallRound < totalRounds; overallRound++) {
		const warmup = overallRound < options.warmups;
		const round = warmup ? overallRound + 1 : overallRound - options.warmups + 1;
		const count = warmup ? options.warmups : options.runs;
		for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex++) {
			const scenario = scenarios[scenarioIndex];
			for (let thinkingIndex = 0; thinkingIndex < options.thinkingEfforts.length; thinkingIndex++) {
				const thinking = options.thinkingEfforts[thinkingIndex];
				for (const target of rotatedTargets(options.targets, overallRound + scenarioIndex + thinkingIndex)) {
				process.stdout.write(
					`[${warmup ? "warmup" : "run"} ${round}/${count}] ${scenario.id} · ${thinking} · ${target.label}\n`,
				);
				const sample = await runSample(
					scenario,
					target,
					options.contextName,
					thinking,
					round,
					warmup,
					options.timeoutMs,
					options.failFastProviderError,
				);
				(warmup ? warmupSamples : samples).push(sample);
				printProgress(sample);
				}
			}
		}
	}

	const summaries = summarizeScenarioBenchmarks(scenarios, options.targets, options.thinkingEfforts, samples);
	const report: ScenarioBenchmarkReport = {
		schemaVersion: 3,
		createdAt,
		config: {
			thinkingEfforts: options.thinkingEfforts,
			runs: options.runs,
			warmups: options.warmups,
			timeoutMs: options.timeoutMs,
			failFastProviderError: options.failFastProviderError,
			order: "rotating-round-robin",
			contextName: options.contextName,
			models: options.targets,
			scenarios: scenarios.map(scenario => ({
				id: scenario.id,
				label: scenario.label,
				suite: scenario.suite,
				tier: scenario.tier,
				prompt: scenario.prompt,
				contract: describeScenarioContract(scenario),
				quality: scenario.quality.map(criterion => ({
					id: criterion.id,
					label: criterion.label,
					weight: criterion.weight,
				})),
				runtime: scenario.runtime,
			})),
		},
		warmups: warmupSamples,
		samples,
		summaries,
	};
	const outputFile = path.resolve(options.outFile ?? defaultModelBenchmarkOutputFile("model-scenarios", createdAt));
	await Bun.write(outputFile, `${JSON.stringify(report, null, 2)}\n`);
	printSummary(summaries);
	process.stdout.write(`\nReport: ${displayModelBenchmarkOutputFile(outputFile)}\n`);
	if (samples.some(sample => !sample.success || !sample.contractPassed)) process.exitCode = 1;
}

if (import.meta.main) {
	main().catch(error => {
		process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
		process.exitCode = 1;
	});
}
