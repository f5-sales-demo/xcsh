#!/usr/bin/env bun
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentSessionEvent } from "../src/session/agent-session";
import { Settings } from "../src/config/settings";
import type { ContextLoadingMode } from "../src/context/profile";
import { createAgentSession } from "../src/sdk";
import { SessionManager } from "../src/session/session-manager";
import { defaultModelBenchmarkOutputFile, displayModelBenchmarkOutputFile } from "./model-benchmark-paths";
import {
	type ContextBenchmarkReport,
	type ContextBenchmarkSample,
	type ContextScenarioId,
	sanitizeContextBenchmarkReport,
	summarizeContextBenchmarks,
} from "./context-report";

const DEFAULT_MODELS = [
	"google-antigravity/gemini-3.7-flash-tiered",
	"openai-codex/gpt-5.6-sol",
	"anthropic/claude-opus-5",
];
const ALL_SCENARIOS: ContextScenarioId[] = [
	"pong",
	"repo-read",
	"deferred-calculator",
	"plugin-catalog",
	"large-tool-result",
	"f5-catalog-read",
];

interface Options {
	profiles: ContextLoadingMode[];
	models: string[];
	scenarios: ContextScenarioId[];
	runs: number;
	warmups: number;
	offlineOnly: boolean;
	out?: string;
}

function valueAfter(args: string[], index: number): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${args[index]} requires a value`);
	return value;
}

export function parseContextBenchmarkArgs(args: string[]): Options {
	const profiles: ContextLoadingMode[] = [];
	const models: string[] = [];
	const scenarios: ContextScenarioId[] = [];
	let runs = 3;
	let warmups = 1;
	let offlineOnly = false;
	let out: string | undefined;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--profile") {
			const value = valueAfter(args, index) as ContextLoadingMode;
			if (value !== "eager" && value !== "progressive") throw new Error("--profile must be eager or progressive");
			profiles.push(value);
			index++;
		} else if (argument === "--model") {
			models.push(valueAfter(args, index));
			index++;
		} else if (argument === "--scenario") {
			const value = valueAfter(args, index) as ContextScenarioId;
			if (!ALL_SCENARIOS.includes(value)) throw new Error(`Unknown scenario: ${value}`);
			scenarios.push(value);
			index++;
		} else if (argument === "--runs" || argument === "--warmups") {
			const value = Number(valueAfter(args, index));
			if (!Number.isInteger(value) || value < (argument === "--runs" ? 1 : 0)) throw new Error(`${argument} is invalid`);
			if (argument === "--runs") runs = value;
			else warmups = value;
			index++;
		} else if (argument === "--offline" || argument === "--offline-only") {
			offlineOnly = true;
		} else if (argument === "--out") {
			out = valueAfter(args, index);
			index++;
		} else if (argument === "--help" || argument === "-h") {
			process.stdout.write("Usage: bun run bench:context [--profile eager|progressive] [--model provider/model] [--scenario id] [--runs N] [--offline-only]\n");
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	return {
		profiles: profiles.length > 0 ? [...new Set(profiles)] : ["eager", "progressive"],
		models: models.length > 0 ? [...new Set(models)] : DEFAULT_MODELS,
		scenarios: scenarios.length > 0 ? [...new Set(scenarios)] : ALL_SCENARIOS,
		runs,
		warmups,
		offlineOnly,
		out,
	};
}

function scenarioContract(scenario: ContextScenarioId): { prompt: string; expected: string } {
	switch (scenario) {
		case "pong":
			return { prompt: "Respond exactly with PONG and nothing else.", expected: "PONG" };
		case "repo-read":
			return { prompt: "Use read to inspect package.json, then respond exactly READ_OK.", expected: "READ_OK" };
		case "deferred-calculator":
			return { prompt: "Discover and activate the calculator tool, use it to compute 17*19, then respond exactly 323.", expected: "323" };
		case "plugin-catalog":
			return { prompt: "Use read on xcsh://plugin, then respond exactly PLUGIN_OK.", expected: "PLUGIN_OK" };
		case "large-tool-result":
			return { prompt: "Discover synthetic_large_output, call it once, then respond exactly LARGE_OK.", expected: "LARGE_OK" };
		case "f5-catalog-read":
			return { prompt: "Read xcsh://api-catalog/ and perform no mutation, then respond exactly CATALOG_OK.", expected: "CATALOG_OK" };
	}
}

function assistantText(events: AgentSessionEvent[]): string {
	const event = [...events].reverse().find(event => event.type === "message_end" && event.message.role === "assistant");
	if (!event || event.type !== "message_end" || event.message.role !== "assistant") return "";
	return event.message.content.flatMap(content => (content.type === "text" ? [content.text] : [])).join("");
}

function isMutatingToolEvent(event: AgentSessionEvent): boolean {
	if (event.type !== "tool_execution_start") return false;
	if (event.toolName !== "xcsh_api") return false;
	const method = typeof event.args?.method === "string" ? event.args.method.toUpperCase() : "";
	return method.length > 0 && method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function largeOutputArtifactContract(events: AgentSessionEvent[]): boolean {
	const event = events.find(
		event => event.type === "tool_execution_end" && event.toolName === "synthetic_large_output",
	);
	if (!event || event.type !== "tool_execution_end") return false;
	const truncation = event.result?.details?.meta?.truncation;
	return (
		typeof truncation?.artifactId === "string" &&
		truncation.totalBytes === 60_000 &&
		truncation.outputBytes <= 20 * 1024 &&
		truncation.outputLines <= 500
	);
}

async function runSample(
	settings: Settings,
	profile: ContextLoadingMode,
	model: string,
	scenario: ContextScenarioId,
	round: number,
	warmup: boolean,
	offlineOnly: boolean,
): Promise<ContextBenchmarkSample> {
	settings.override("context.loadingMode", profile);
	const skipAuthenticated = scenario === "f5-catalog-read" && (!Bun.env.XCSH_API_URL || !Bun.env.XCSH_API_TOKEN);
	const events: AgentSessionEvent[] = [];
	let ttftMs: number | undefined;
	let startedAt = 0;
	const { session } = await createAgentSession({
		cwd: path.resolve(import.meta.dir, "../../.."),
		settings,
		modelPattern: model,
		sessionManager: SessionManager.inMemory(),
		disableExtensionDiscovery: false,
		enableMCP: false,
		enableLsp: false,
		customTools:
			scenario === "large-tool-result"
				? [
						{
							name: "synthetic_large_output",
							label: "Synthetic Large Output",
							description: "Return deterministic 60KB benchmark text",
							parameters: { type: "object", properties: {} } as never,
							async execute() {
								return { content: [{ type: "text" as const, text: "x".repeat(60_000) }] };
							},
						},
					]
				: undefined,
	});
	const unsubscribe = session.subscribe(event => {
		events.push(event);
		if (
			ttftMs === undefined &&
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "text_delta" &&
			event.assistantMessageEvent.delta.length > 0
		) {
			ttftMs = performance.now() - startedAt;
		}
	});
	const contract = scenarioContract(scenario);
	startedAt = performance.now();
	try {
		if (!offlineOnly && !skipAuthenticated) await session.prompt(contract.prompt);
		const durationMs = performance.now() - startedAt;
		const contextProfile = session.getContextProfile();
		const toolCalls = events.filter(event => event.type === "tool_execution_start");
		const discoveryCalls = toolCalls.filter(
			event => event.type === "tool_execution_start" && event.toolName === "search_tool_bm25",
		).length;
		const mutatingToolCalls = events.filter(isMutatingToolEvent).length;
		const artifactSpillPassed = scenario === "large-tool-result" ? largeOutputArtifactContract(events) : undefined;
		const responsePassed = assistantText(events).trim() === contract.expected;
		const behaviorPassed =
			discoveryCalls <= 1 && mutatingToolCalls === 0 && (artifactSpillPassed === undefined || artifactSpillPassed);
		return {
			profile,
			model,
			scenario,
			round,
			warmup,
			skipped: skipAuthenticated,
			contractPassed: offlineOnly
				? contextProfile.systemPromptBytes <= (profile === "progressive" ? 40_000 : Number.MAX_SAFE_INTEGER)
				: responsePassed && behaviorPassed,
			durationMs,
			ttftMs,
			turns: events.filter(event => event.type === "turn_end").length,
			toolCalls: toolCalls.length,
			discoveryCalls,
			mutatingToolCalls,
			artifactSpillPassed,
			deferredContextAvoidedBytes: contextProfile.deferredToolBytes,
			providerCalls: contextProfile.providerCalls,
			static: {
				systemPromptBytes: contextProfile.systemPromptBytes,
				initialToolBytes: contextProfile.initialToolBytes,
				deferredToolBytes: contextProfile.deferredToolBytes,
			},
		};
	} finally {
		unsubscribe();
		await session.dispose();
	}
}

export async function runContextBenchmark(options: Options): Promise<ContextBenchmarkReport> {
	const settings = await Settings.init();
	const samples: ContextBenchmarkSample[] = [];
	const totalRounds = options.warmups + options.runs;
	for (let round = 0; round < totalRounds; round++) {
		const profiles = round % 2 === 0 ? options.profiles : [...options.profiles].reverse();
		for (const profile of profiles) {
			for (const model of options.models) {
				for (const scenario of options.scenarios) {
					const singleRunScenario = scenario === "large-tool-result" || scenario === "f5-catalog-read";
					if (singleRunScenario && round > options.warmups) continue;
					const sample = await runSample(
						settings,
						profile,
						model,
						scenario,
						round,
						round < options.warmups,
						options.offlineOnly,
					);
					samples.push(sample);
					process.stderr.write(`${profile} ${model} ${scenario}: ${sample.skipped ? "skip" : sample.contractPassed ? "pass" : "fail"}\n`);
				}
			}
		}
	}
	return sanitizeContextBenchmarkReport({
		schemaVersion: 1,
		createdAt: new Date().toISOString(),
		offlineOnly: options.offlineOnly,
		samples,
		summaries: summarizeContextBenchmarks(samples),
	});
}

if (import.meta.main) {
	const options = parseContextBenchmarkArgs(process.argv.slice(2));
	const report = await runContextBenchmark(options);
	const output = options.out ?? defaultModelBenchmarkOutputFile("context", report.createdAt);
	await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
	await fs.chmod(path.dirname(output), 0o700);
	await Bun.write(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
	await fs.chmod(output, 0o600);
	process.stdout.write(`${JSON.stringify(report.summaries, null, 2)}\nReport: ${displayModelBenchmarkOutputFile(output)}\n`);
}
