/** Pure event parsing and aggregation for the live xcsh model matrix benchmark. */

export interface ModelBenchmarkTarget {
	label: string;
	selector: string;
}

export interface TimedJsonEvent {
	elapsedMs: number;
	event: unknown;
}

export interface ModelBenchmarkUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costTotal: number;
}

export interface BuildModelBenchmarkSampleInput {
	target: ModelBenchmarkTarget;
	round: number;
	warmup: boolean;
	startedAt: string;
	processDurationMs: number;
	exitCode: number;
	timedOut: boolean;
	stderr: string;
	stdoutErrors: string[];
	events: TimedJsonEvent[];
	expectedResponse: string;
}

export interface ModelBenchmarkSample {
	label: string;
	selector: string;
	round: number;
	warmup: boolean;
	startedAt: string;
	provider?: string;
	model?: string;
	success: boolean;
	responseExact: boolean;
	response: string;
	stopReason?: string;
	error?: string;
	stderr?: string;
	exitCode: number;
	timedOut: boolean;
	eventCount: number;
	startupMs?: number;
	ttftMs?: number;
	startupInclusiveTtftMs?: number;
	responseDurationMs?: number;
	processDurationMs: number;
	providerReportedTtftMs?: number;
	providerReportedDurationMs?: number;
	outputTokensPerSecond?: number;
	usage?: ModelBenchmarkUsage;
}

export interface NumericSummary {
	min: number;
	p50: number;
	p95: number;
	max: number;
}

export interface ModelBenchmarkSummary {
	label: string;
	selector: string;
	samples: number;
	successes: number;
	exactResponses: number;
	successRate: number;
	exactResponseRate: number;
	latencyMs: {
		startup: NumericSummary | null;
		ttft: NumericSummary | null;
		startupInclusiveTtft: NumericSummary | null;
		response: NumericSummary | null;
		process: NumericSummary | null;
		providerReportedTtft: NumericSummary | null;
		providerReportedDuration: NumericSummary | null;
	};
	outputTokensPerSecond: NumericSummary | null;
	tokens: {
		input: NumericSummary | null;
		output: NumericSummary | null;
		cacheRead: NumericSummary | null;
		cacheWrite: NumericSummary | null;
	};
}

export interface ModelBenchmarkReport {
	schemaVersion: 1;
	createdAt: string;
	config: {
		prompt: string;
		expectedResponse: string;
		thinking: "high";
		runs: number;
		warmups: number;
		timeoutMs: number;
		order: "rotating-round-robin";
		models: ModelBenchmarkTarget[];
	};
	warmups: ModelBenchmarkSample[];
	samples: ModelBenchmarkSample[];
	summaries: ModelBenchmarkSummary[];
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function readUsage(message: Record<string, unknown>): ModelBenchmarkUsage | undefined {
	const usage = record(message.usage);
	if (!usage) return undefined;
	const cost = record(usage.cost);
	return {
		input: finiteNumber(usage.input) ?? 0,
		output: finiteNumber(usage.output) ?? 0,
		cacheRead: finiteNumber(usage.cacheRead) ?? 0,
		cacheWrite: finiteNumber(usage.cacheWrite) ?? 0,
		totalTokens: finiteNumber(usage.totalTokens) ?? 0,
		costTotal: finiteNumber(cost?.total) ?? 0,
	};
}

function selectorParts(selector: string): { provider: string; model: string } | undefined {
	const slash = selector.indexOf("/");
	if (slash <= 0 || slash === selector.length - 1) return undefined;
	return { provider: selector.slice(0, slash), model: selector.slice(slash + 1) };
}

export function buildModelBenchmarkSample(input: BuildModelBenchmarkSampleInput): ModelBenchmarkSample {
	let provider: string | undefined;
	let model: string | undefined;
	let promptAt: number | undefined;
	let firstTextAt: number | undefined;
	let assistantEndAt: number | undefined;
	let finalMessage: Record<string, unknown> | undefined;
	let response = "";

	for (const timed of input.events) {
		const event = record(timed.event);
		if (!event) continue;
		const type = stringValue(event.type);
		if (type === "session") {
			provider = stringValue(event.provider) ?? provider;
			model = stringValue(event.model) ?? model;
			continue;
		}

		const message = record(event.message);
		if (type === "message_start" && record(message)?.role === "user" && promptAt === undefined) {
			promptAt = timed.elapsedMs;
		}
		if (type === "message_update") {
			const assistantEvent = record(event.assistantMessageEvent);
			if (assistantEvent?.type === "text_delta") {
				const delta = stringValue(assistantEvent.delta);
				if (delta !== undefined) {
					response += delta;
					if (delta.length > 0 && firstTextAt === undefined) firstTextAt = timed.elapsedMs;
				}
			}
		}
		if (type === "message_end" && message?.role === "assistant") {
			assistantEndAt = timed.elapsedMs;
			finalMessage = message;
			provider = stringValue(message.provider) ?? provider;
			model = stringValue(message.model) ?? model;
		}
	}

	const failures = [...input.stdoutErrors];
	if (input.timedOut) failures.push("process timed out");
	if (input.exitCode !== 0) failures.push(`process exited ${input.exitCode}`);
	if (promptAt === undefined) failures.push("user prompt event missing");
	if (firstTextAt === undefined) failures.push("non-empty text delta missing");
	if (!finalMessage || assistantEndAt === undefined) failures.push("assistant completion event missing");

	const expected = selectorParts(input.target.selector);
	if (expected && provider && model && (provider !== expected.provider || model !== expected.model)) {
		failures.push(`resolved ${provider}/${model} instead of ${input.target.selector}`);
	}

	const providerReportedTtftMs = finiteNumber(finalMessage?.ttft);
	const providerReportedDurationMs = finiteNumber(finalMessage?.duration);
	const usage = finalMessage ? readUsage(finalMessage) : undefined;
	const outputTokensPerSecond =
		usage && providerReportedDurationMs !== undefined && providerReportedDurationMs > 0
			? round((usage.output * 1000) / providerReportedDurationMs)
			: undefined;

	return {
		label: input.target.label,
		selector: input.target.selector,
		round: input.round,
		warmup: input.warmup,
		startedAt: input.startedAt,
		provider,
		model,
		success: failures.length === 0,
		responseExact: response === input.expectedResponse,
		response,
		stopReason: stringValue(finalMessage?.stopReason),
		error: failures.length > 0 ? failures.join("; ") : undefined,
		stderr: input.stderr.trim() || undefined,
		exitCode: input.exitCode,
		timedOut: input.timedOut,
		eventCount: input.events.length,
		startupMs: promptAt === undefined ? undefined : round(promptAt),
		ttftMs:
			promptAt === undefined || firstTextAt === undefined ? undefined : round(firstTextAt - promptAt),
		startupInclusiveTtftMs: firstTextAt === undefined ? undefined : round(firstTextAt),
		responseDurationMs:
			promptAt === undefined || assistantEndAt === undefined ? undefined : round(assistantEndAt - promptAt),
		processDurationMs: round(input.processDurationMs),
		providerReportedTtftMs,
		providerReportedDurationMs,
		outputTokensPerSecond,
		usage,
	};
}

export function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function nearestRankPercentile(values: number[], percentile: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(percentile * sorted.length) - 1));
	return sorted[index];
}

function summarizeNumbers(values: Array<number | undefined>): NumericSummary | null {
	const present = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
	if (present.length === 0) return null;
	return {
		min: round(Math.min(...present)),
		p50: round(median(present)),
		p95: round(nearestRankPercentile(present, 0.95)),
		max: round(Math.max(...present)),
	};
}

export function summarizeModelBenchmarks(
	targets: ModelBenchmarkTarget[],
	samples: ModelBenchmarkSample[],
): ModelBenchmarkSummary[] {
	return targets.map(target => {
		const modelSamples = samples.filter(sample => sample.selector === target.selector && !sample.warmup);
		const successful = modelSamples.filter(sample => sample.success);
		const exactResponses = modelSamples.filter(sample => sample.responseExact).length;
		const count = modelSamples.length;
		return {
			label: target.label,
			selector: target.selector,
			samples: count,
			successes: successful.length,
			exactResponses,
			successRate: count === 0 ? 0 : round(successful.length / count),
			exactResponseRate: count === 0 ? 0 : round(exactResponses / count),
			latencyMs: {
				startup: summarizeNumbers(successful.map(sample => sample.startupMs)),
				ttft: summarizeNumbers(successful.map(sample => sample.ttftMs)),
				startupInclusiveTtft: summarizeNumbers(successful.map(sample => sample.startupInclusiveTtftMs)),
				response: summarizeNumbers(successful.map(sample => sample.responseDurationMs)),
				process: summarizeNumbers(successful.map(sample => sample.processDurationMs)),
				providerReportedTtft: summarizeNumbers(successful.map(sample => sample.providerReportedTtftMs)),
				providerReportedDuration: summarizeNumbers(successful.map(sample => sample.providerReportedDurationMs)),
			},
			outputTokensPerSecond: summarizeNumbers(successful.map(sample => sample.outputTokensPerSecond)),
			tokens: {
				input: summarizeNumbers(successful.map(sample => sample.usage?.input)),
				output: summarizeNumbers(successful.map(sample => sample.usage?.output)),
				cacheRead: summarizeNumbers(successful.map(sample => sample.usage?.cacheRead)),
				cacheWrite: summarizeNumbers(successful.map(sample => sample.usage?.cacheWrite)),
			},
		};
	});
}
