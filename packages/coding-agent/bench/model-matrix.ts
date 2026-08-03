/**
 * Live xcsh model benchmark. Runs identical prompt turns in fresh processes using a
 * rotating round-robin order and records both harness-observed and provider-reported timing.
 *
 * Run: bun packages/coding-agent/bench/model-matrix.ts [--runs 3] [--warmups 1]
 */
import * as path from "node:path";
import { readLines, readStreamCappedText } from "@f5-sales-demo/pi-utils";
import {
	defaultModelBenchmarkOutputFile,
	displayModelBenchmarkOutputFile,
} from "./model-benchmark-paths";
import pingPrompt from "./prompts/model-ping.md" with { type: "text" };
import {
	buildModelBenchmarkSample,
	type ModelBenchmarkReport,
	type ModelBenchmarkSample,
	type ModelBenchmarkSummary,
	type ModelBenchmarkTarget,
	summarizeModelBenchmarks,
	type TimedJsonEvent,
} from "./model-matrix-report";

const CLI = path.join(import.meta.dir, "../src/cli.ts");
const REPO_ROOT = path.join(import.meta.dir, "../../..");
const EXPECTED_RESPONSE = "PONG";
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
	targets: ModelBenchmarkTarget[];
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

function positiveInteger(value: string, name: string, allowZero = false): number {
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

function parseArgs(args: string[]): CliOptions {
	let runs = 3;
	let warmups = 1;
	let timeoutMs = 120_000;
	let outFile: string | undefined;
	const targets: ModelBenchmarkTarget[] = [];
	for (let i = 0; i < args.length; i++) {
		const argument = args[i];
		if (argument === "--runs") {
			runs = positiveInteger(readValue(args, i, argument), argument);
			i++;
		} else if (argument === "--warmups") {
			warmups = positiveInteger(readValue(args, i, argument), argument, true);
			i++;
		} else if (argument === "--timeout-ms") {
			timeoutMs = positiveInteger(readValue(args, i, argument), argument);
			i++;
		} else if (argument === "--out") {
			outFile = readValue(args, i, argument);
			i++;
		} else if (argument === "--model") {
			targets.push(parseTarget(readValue(args, i, argument)));
			i++;
		} else if (argument === "--help" || argument === "-h") {
			process.stdout.write(
				"Usage: bun bench:models [--runs N] [--warmups N] [--timeout-ms N] [--out FILE] [--model LABEL=PROVIDER/MODEL]\n",
			);
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	return { runs, warmups, timeoutMs, outFile, targets: targets.length > 0 ? targets : DEFAULT_TARGETS };
}

function elapsedMs(startNs: number): number {
	return (Bun.nanoseconds() - startNs) / 1e6;
}

async function captureEvents(stream: ReadableStream<Uint8Array>, startNs: number): Promise<CapturedEvents> {
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
		for (const event of parsed) events.push({ elapsedMs: receivedAt, event });
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

async function runSample(
	target: ModelBenchmarkTarget,
	round: number,
	warmup: boolean,
	timeoutMs: number,
): Promise<ModelBenchmarkSample> {
	const startedAt = new Date().toISOString();
	const startNs = Bun.nanoseconds();
	const child = Bun.spawn(
		[
			process.execPath,
			CLI,
			"--mode",
			"json",
			"--no-session",
			"--no-memories",
			"--no-tools",
			"--no-mcp",
			"--no-lsp",
			"--no-extensions",
			"--no-skills",
			"--no-rules",
			"--no-title",
			"--thinking",
			"high",
			"--model",
			target.selector,
			pingPrompt.trim(),
		],
		{
			cwd: REPO_ROOT,
			env: process.env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const stdoutPromise = captureEvents(child.stdout as ReadableStream<Uint8Array>, startNs).catch(error => ({
		events: [],
		errors: [error instanceof Error ? error.message : String(error)],
	}));
	const stderrPromise = readStreamCappedText(child.stderr as ReadableStream<Uint8Array>, {
		maxBytes: 1024 * 1024,
		source: target.selector,
	}).catch(error => (error instanceof Error ? error.message : String(error)));
	const outcome = await waitForExit(child, timeoutMs);
	const exitCode = outcome.timedOut ? await terminateProcess(child) : outcome.exitCode;
	const [captured, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
	return buildModelBenchmarkSample({
		target,
		round,
		warmup,
		startedAt,
		processDurationMs: elapsedMs(startNs),
		exitCode,
		timedOut: outcome.timedOut,
		stderr,
		stdoutErrors: captured.errors,
		events: captured.events,
		expectedResponse: EXPECTED_RESPONSE,
	});
}

function rotatedTargets(targets: ModelBenchmarkTarget[], round: number): ModelBenchmarkTarget[] {
	const offset = round % targets.length;
	return [...targets.slice(offset), ...targets.slice(0, offset)];
}

function formatNumber(value: number | undefined, suffix = ""): string {
	return value === undefined ? "-" : `${value.toFixed(1)}${suffix}`;
}

function printProgress(sample: ModelBenchmarkSample): void {
	const status = sample.success && sample.responseExact ? "ok" : "FAIL";
	process.stdout.write(
		`  ${status.padEnd(4)} ttft=${formatNumber(sample.ttftMs, "ms")} total=${formatNumber(sample.responseDurationMs, "ms")} response=${JSON.stringify(sample.response)}\n`,
	);
	if (sample.error) process.stdout.write(`       ${sample.error}\n`);
}

function printSummary(summaries: ModelBenchmarkSummary[]): void {
	const rows = summaries.map(summary => ({
		model: summary.label,
		ok: `${summary.successes}/${summary.samples}`,
		exact: `${summary.exactResponses}/${summary.samples}`,
		ttft50: formatNumber(summary.latencyMs.ttft?.p50),
		ttft95: formatNumber(summary.latencyMs.ttft?.p95),
		inclusive: formatNumber(summary.latencyMs.startupInclusiveTtft?.p50),
		total: formatNumber(summary.latencyMs.response?.p50),
		tokens: formatNumber(summary.outputTokensPerSecond?.p50),
	}));
	const header = ["model", "ok", "exact", "ttft p50", "ttft p95", "incl p50", "total p50", "out tok/s"];
	const widths = header.map((value, index) =>
		Math.max(value.length, ...rows.map(row => Object.values(row)[index]?.length ?? 0)),
	);
	const line = (values: string[]): string => values.map((value, index) => value.padEnd(widths[index])).join("  ");
	process.stdout.write(`\n${line(header)}\n${line(widths.map(width => "-".repeat(width)))}\n`);
	for (const row of rows) process.stdout.write(`${line(Object.values(row))}\n`);
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const createdAt = new Date().toISOString();
	const warmupSamples: ModelBenchmarkSample[] = [];
	const samples: ModelBenchmarkSample[] = [];
	const totalRounds = options.warmups + options.runs;
	for (let overallRound = 0; overallRound < totalRounds; overallRound++) {
		const warmup = overallRound < options.warmups;
		const round = warmup ? overallRound + 1 : overallRound - options.warmups + 1;
		const count = warmup ? options.warmups : options.runs;
		for (const target of rotatedTargets(options.targets, overallRound)) {
			process.stdout.write(`[${warmup ? "warmup" : "run"} ${round}/${count}] ${target.label}\n`);
			const sample = await runSample(target, round, warmup, options.timeoutMs);
			(warmup ? warmupSamples : samples).push(sample);
			printProgress(sample);
		}
	}

	const summaries = summarizeModelBenchmarks(options.targets, samples);
	const report: ModelBenchmarkReport = {
		schemaVersion: 1,
		createdAt,
		config: {
			prompt: pingPrompt.trim(),
			expectedResponse: EXPECTED_RESPONSE,
			thinking: "high",
			runs: options.runs,
			warmups: options.warmups,
			timeoutMs: options.timeoutMs,
			order: "rotating-round-robin",
			models: options.targets,
		},
		warmups: warmupSamples,
		samples,
		summaries,
	};
	const outputFile = path.resolve(options.outFile ?? defaultModelBenchmarkOutputFile("model-ping", createdAt));
	await Bun.write(outputFile, `${JSON.stringify(report, null, 2)}\n`);
	printSummary(summaries);
	process.stdout.write(`\nReport: ${displayModelBenchmarkOutputFile(outputFile)}\n`);

	if (samples.some(sample => !sample.success || !sample.responseExact)) process.exitCode = 1;
}

main().catch(error => {
	process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
	process.exitCode = 1;
});
