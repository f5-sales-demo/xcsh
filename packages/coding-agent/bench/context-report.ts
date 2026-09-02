import type { ContextLoadingMode, ContextProfile, ProviderCallProfile } from "../src/context/profile";

export type ContextScenarioId =
	| "pong"
	| "repo-read"
	| "deferred-calculator"
	| "plugin-catalog"
	| "large-tool-result"
	| "f5-catalog-read";

export interface ContextBenchmarkSample {
	profile: ContextLoadingMode;
	model: string;
	scenario: ContextScenarioId;
	round: number;
	warmup: boolean;
	skipped: boolean;
	contractPassed: boolean;
	durationMs: number;
	ttftMs?: number;
	turns: number;
	toolCalls: number;
	discoveryCalls: number;
	mutatingToolCalls: number;
	artifactSpillPassed?: boolean;
	deferredContextAvoidedBytes: number;
	providerCalls: ProviderCallProfile[];
	static: Pick<ContextProfile, "systemPromptBytes" | "initialToolBytes" | "deferredToolBytes">;
}

export interface ContextBenchmarkSummary {
	profile: ContextLoadingMode;
	model: string;
	scenario: ContextScenarioId;
	measuredRuns: number;
	passedRuns: number;
	medianPromptTokens?: number;
	medianWindowPercentage?: number;
	medianDurationMs: number;
	medianTtftMs?: number;
}

export interface ContextBenchmarkReport {
	schemaVersion: 1;
	createdAt: string;
	offlineOnly: boolean;
	samples: ContextBenchmarkSample[];
	summaries: ContextBenchmarkSummary[];
}

function median(values: number[]): number | undefined {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle];
}

export function summarizeContextBenchmarks(samples: ContextBenchmarkSample[]): ContextBenchmarkSummary[] {
	const groups = new Map<string, ContextBenchmarkSample[]>();
	for (const sample of samples.filter(sample => !sample.warmup && !sample.skipped)) {
		const key = `${sample.profile}\0${sample.model}\0${sample.scenario}`;
		const group = groups.get(key) ?? [];
		group.push(sample);
		groups.set(key, group);
	}
	return Array.from(groups.values(), group => {
		const first = group[0];
		const calls = group.flatMap(sample => sample.providerCalls);
		return {
			profile: first.profile,
			model: first.model,
			scenario: first.scenario,
			measuredRuns: group.length,
			passedRuns: group.filter(sample => sample.contractPassed).length,
			medianPromptTokens: median(calls.flatMap(call => call.providerPromptTokens ?? [])),
			medianWindowPercentage: median(calls.flatMap(call => call.windowPercentage ?? [])),
			medianDurationMs: median(group.map(sample => sample.durationMs)) ?? 0,
			medianTtftMs: median(group.flatMap(sample => sample.ttftMs ?? [])),
		};
	});
}

/** Guard committed/printed aggregates against accidentally acquiring content-bearing fields. */
export function sanitizeContextBenchmarkReport(report: ContextBenchmarkReport): ContextBenchmarkReport {
	return {
		schemaVersion: 1,
		createdAt: report.createdAt,
		offlineOnly: report.offlineOnly,
		samples: report.samples.map(sample => ({
			profile: sample.profile,
			model: sample.model,
			scenario: sample.scenario,
			round: sample.round,
			warmup: sample.warmup,
			skipped: sample.skipped,
			contractPassed: sample.contractPassed,
			durationMs: sample.durationMs,
			ttftMs: sample.ttftMs,
			turns: sample.turns,
			toolCalls: sample.toolCalls,
			discoveryCalls: sample.discoveryCalls,
			mutatingToolCalls: sample.mutatingToolCalls,
			artifactSpillPassed: sample.artifactSpillPassed,
			deferredContextAvoidedBytes: sample.deferredContextAvoidedBytes,
			providerCalls: sample.providerCalls.map(call => ({
				call: call.call,
				provider: call.provider,
				model: call.model,
				api: call.api,
				payloadBytes: call.payloadBytes,
				estimatedPayloadTokens: call.estimatedPayloadTokens,
				categoryBytes: { ...call.categoryBytes },
				toolCount: call.toolCount,
				messageCount: call.messageCount,
				tools: call.tools.map(tool => ({ ...tool })),
				messages: call.messages.map(message => ({ ...message })),
				contextWindow: call.contextWindow,
				providerInputTokens: call.providerInputTokens,
				providerCacheReadTokens: call.providerCacheReadTokens,
				providerCacheWriteTokens: call.providerCacheWriteTokens,
				providerPromptTokens: call.providerPromptTokens,
				providerOutputTokens: call.providerOutputTokens,
				windowPercentage: call.windowPercentage,
			})),
			static: { ...sample.static },
		})),
		summaries: report.summaries.map(summary => ({ ...summary })),
	};
}
