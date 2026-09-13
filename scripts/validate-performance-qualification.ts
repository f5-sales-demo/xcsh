#!/usr/bin/env bun

import { appendFileSync } from "node:fs";
import * as path from "node:path";

export const REQUIRED_PHASES = ["setup", "install", "native", "test-typescript", "test-rust"] as const;

export interface WorkloadProfile {
	cache_state: "cold" | "warm" | "unknown";
	commit: string | null;
	duration_seconds: number;
	exit: { code: number; signal: number | null };
	image_digest: string | null;
	memory: {
		events: Record<string, number>;
		peak_bytes: number | null;
		peak_limit_ratio: number | null;
	};
	output_digest: string | null;
	pair_id: string | null;
	phase: string;
	variant: string;
}

export interface QualificationOptions {
	baselineVariant: string;
	candidateVariant: string;
	expectedSourceCommit: string;
	targetPhases: readonly string[];
	minimumMedianImprovement?: number;
}

interface PhaseReport {
	baseline_median_seconds: number;
	baseline_p95_seconds: number;
	cache_state: "cold" | "warm";
	candidate_median_seconds: number;
	candidate_p95_seconds: number;
	max_peak_memory_bytes: number;
	max_peak_memory_ratio: number;
	median_improvement_ratio: number;
	output_equivalent: boolean;
	paired_runs: number;
	phase: string;
	qualifies: boolean;
	source_identity_valid: boolean;
	stable: boolean;
	targeted: boolean;
}

export interface QualificationReport {
	baseline_variant: string;
	candidate_variant: string;
	expected_source_commit: string;
	qualifies: boolean;
	reports: PhaseReport[];
}

export function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
}

export function nearestRankP95(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function profileIsStable(profile: WorkloadProfile): boolean {
	return (
		profile.exit.code === 0 &&
		profile.exit.signal === null &&
		(profile.memory.events.oom ?? 0) === 0 &&
		(profile.memory.events.oom_kill ?? 0) === 0
	);
}

export function evaluateQualification(
	profiles: readonly WorkloadProfile[],
	options: QualificationOptions,
): QualificationReport {
	const reports: PhaseReport[] = [];
	const minimumMedianImprovement = options.minimumMedianImprovement ?? 0.2;
	const phases = [...new Set([...REQUIRED_PHASES, ...options.targetPhases])];
	for (const phase of phases) {
		for (const cacheState of ["cold", "warm"] as const) {
			const matching = profiles.filter(profile => profile.phase === phase && profile.cache_state === cacheState);
			const baseline = new Map(
				matching
					.filter(profile => profile.variant === options.baselineVariant && profile.pair_id)
					.map(profile => [profile.pair_id, profile]),
			);
			const candidate = new Map(
				matching
					.filter(profile => profile.variant === options.candidateVariant && profile.pair_id)
					.map(profile => [profile.pair_id, profile]),
			);
			const pairs = [...baseline.keys()].filter(pair => candidate.has(pair)).sort();
			const baselineProfiles = pairs.map(pair => baseline.get(pair) as WorkloadProfile);
			const candidateProfiles = pairs.map(pair => candidate.get(pair) as WorkloadProfile);
			const baselineDurations = baselineProfiles.map(profile => profile.duration_seconds);
			const candidateDurations = candidateProfiles.map(profile => profile.duration_seconds);
			const allProfiles = [...baselineProfiles, ...candidateProfiles];
			const baselineMedian = median(baselineDurations);
			const candidateMedian = median(candidateDurations);
			const medianImprovement = baselineMedian === 0 ? 0 : (baselineMedian - candidateMedian) / baselineMedian;
			const sourceIdentityValid = allProfiles.every(profile => profile.commit === options.expectedSourceCommit);
			const outputEquivalent = pairs.every(pair => {
				const baselineProfile = baseline.get(pair);
				const candidateProfile = candidate.get(pair);
				return baselineProfile?.output_digest !== null && baselineProfile?.output_digest === candidateProfile?.output_digest;
			});
			const stable = allProfiles.every(profileIsStable);
			const memoryRatios = allProfiles.map(profile => profile.memory.peak_limit_ratio);
			const maxPeakMemoryRatio =
				memoryRatios.length === 0 ? 1 : Math.max(...memoryRatios.map(ratio => ratio ?? Number.POSITIVE_INFINITY));
			const baselineP95 = nearestRankP95(baselineDurations);
			const candidateP95 = nearestRankP95(candidateDurations);
			const targeted = options.targetPhases.includes(phase);
			const qualifies =
				pairs.length >= 5 &&
				sourceIdentityValid &&
				outputEquivalent &&
				stable &&
				maxPeakMemoryRatio < 0.8 &&
				candidateP95 <= baselineP95 &&
				(!targeted || medianImprovement >= minimumMedianImprovement);
			reports.push({
				baseline_median_seconds: baselineMedian,
				baseline_p95_seconds: baselineP95,
				cache_state: cacheState,
				candidate_median_seconds: candidateMedian,
				candidate_p95_seconds: candidateP95,
				max_peak_memory_bytes: Math.max(...allProfiles.map(profile => profile.memory.peak_bytes ?? 0)),
				max_peak_memory_ratio: maxPeakMemoryRatio,
				median_improvement_ratio: medianImprovement,
				output_equivalent: outputEquivalent,
				paired_runs: pairs.length,
				phase,
				qualifies,
				source_identity_valid: sourceIdentityValid,
				stable,
				targeted,
			});
		}
	}
	return {
		baseline_variant: options.baselineVariant,
		candidate_variant: options.candidateVariant,
		expected_source_commit: options.expectedSourceCommit,
		qualifies: reports.every(report => report.qualifies),
		reports,
	};
}

export async function loadProfiles(inputDirectory: string): Promise<WorkloadProfile[]> {
	const profiles: WorkloadProfile[] = [];
	const glob = new Bun.Glob("**/profiles/*.json");
	for await (const relativePath of glob.scan({ cwd: inputDirectory, onlyFiles: true })) {
		profiles.push((await Bun.file(path.join(inputDirectory, relativePath)).json()) as WorkloadProfile);
	}
	return profiles;
}

function renderSummary(report: QualificationReport): string {
	const rows = report.reports.map(item =>
		`| ${item.phase} | ${item.cache_state} | ${item.paired_runs} | ${item.baseline_median_seconds.toFixed(3)} | ${item.candidate_median_seconds.toFixed(3)} | ${(item.median_improvement_ratio * 100).toFixed(1)}% | ${item.baseline_p95_seconds.toFixed(3)} | ${item.candidate_p95_seconds.toFixed(3)} | ${(item.max_peak_memory_ratio * 100).toFixed(1)}% | ${item.qualifies ? "pass" : "fail"} |`,
	);
	return [
		"### Performance qualification",
		"",
		"| Phase | Cache | Pairs | Baseline median | Candidate median | Improvement | Baseline p95 | Candidate p95 | Peak memory | Result |",
		"| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
		...rows,
		"",
		`Overall: **${report.qualifies ? "pass" : "fail"}**`,
		"",
	].join("\n");
}

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index < 0 ? undefined : process.argv[index + 1];
}

if (import.meta.main) {
	const inputDirectory = argument("--input");
	const outputPath = argument("--out");
	const baselineVariant = argument("--baseline-variant");
	const candidateVariant = argument("--candidate-variant");
	const expectedSourceCommit = argument("--source-sha");
	const targetPhases = argument("--target-phases")?.split(",").filter(Boolean);
	if (!inputDirectory || !outputPath || !baselineVariant || !candidateVariant || !expectedSourceCommit || !targetPhases?.length) {
		console.error(
			"usage: validate-performance-qualification.ts --input <dir> --baseline-variant <name> --candidate-variant <name> --source-sha <sha> --target-phases <csv> --out <report.json>",
		);
		process.exit(2);
	}
	const report = evaluateQualification(await loadProfiles(inputDirectory), {
		baselineVariant,
		candidateVariant,
		expectedSourceCommit,
		targetPhases,
	});
	await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
	const summary = renderSummary(report);
	console.log(summary);
	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
	if (!report.qualifies) process.exit(1);
}
