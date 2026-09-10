#!/usr/bin/env bun

import { appendFileSync } from "node:fs";
import * as path from "node:path";

export const REQUIRED_PHASES = [
	"install-software",
	"native-software",
	"test-software",
	"release-software",
	"startup-software",
	"ttft-cold-software",
	"ttft-warm-software",
] as const;

export interface WorkloadProfile {
	cache_state: "cold" | "warm" | "unknown";
	commit: string | null;
	duration_seconds: number;
	exit: { code: number; signal: number | null };
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

interface PhaseReport {
	baseline_median_seconds: number;
	baseline_p95_seconds: number;
	cache_state: "cold" | "warm";
	candidate_median_seconds: number;
	candidate_p95_seconds: number;
	max_peak_memory_bytes: number;
	max_peak_memory_ratio: number;
	output_equivalent: boolean;
	paired_runs: number;
	phase: string;
	qualifies: boolean;
	stable: boolean;
}

export interface QualificationReport {
	baseline_variant: string;
	candidate_variant: string;
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
	baselineVariant = "baseline",
	candidateVariant = "bun-1.4.2",
): QualificationReport {
	const reports: PhaseReport[] = [];
	for (const phase of REQUIRED_PHASES) {
		for (const cacheState of ["cold", "warm"] as const) {
			const matching = profiles.filter(profile => profile.phase === phase && profile.cache_state === cacheState);
			const baseline = new Map(
				matching.filter(profile => profile.variant === baselineVariant && profile.pair_id).map(profile => [profile.pair_id, profile]),
			);
			const candidate = new Map(
				matching.filter(profile => profile.variant === candidateVariant && profile.pair_id).map(profile => [profile.pair_id, profile]),
			);
			const pairs = [...baseline.keys()].filter(pair => candidate.has(pair)).sort();
			const baselineProfiles = pairs.map(pair => baseline.get(pair) as WorkloadProfile);
			const candidateProfiles = pairs.map(pair => candidate.get(pair) as WorkloadProfile);
			const baselineDurations = baselineProfiles.map(profile => profile.duration_seconds);
			const candidateDurations = candidateProfiles.map(profile => profile.duration_seconds);
			const allProfiles = [...baselineProfiles, ...candidateProfiles];
			const outputEquivalent = pairs.every(pair => {
				const baselineProfile = baseline.get(pair);
				const candidateProfile = candidate.get(pair);
				return (
					baselineProfile?.commit === candidateProfile?.commit &&
					baselineProfile?.output_digest !== null &&
					baselineProfile?.output_digest === candidateProfile?.output_digest
				);
			});
			const stable = allProfiles.every(profile => profileIsStable(profile));
			const memoryRatios = allProfiles.map(profile => profile.memory.peak_limit_ratio);
			const maxPeakMemoryRatio =
				memoryRatios.length === 0 ? 1 : Math.max(...memoryRatios.map(ratio => ratio ?? Number.POSITIVE_INFINITY));
			const baselineP95 = nearestRankP95(baselineDurations);
			const candidateP95 = nearestRankP95(candidateDurations);
			const qualifies =
				pairs.length >= 5 &&
				outputEquivalent &&
				stable &&
				maxPeakMemoryRatio < 0.8 &&
				candidateP95 <= baselineP95;
			reports.push({
				baseline_median_seconds: median(baselineDurations),
				baseline_p95_seconds: baselineP95,
				cache_state: cacheState,
				candidate_median_seconds: median(candidateDurations),
				candidate_p95_seconds: candidateP95,
				max_peak_memory_bytes: Math.max(...allProfiles.map(profile => profile.memory.peak_bytes ?? 0)),
				max_peak_memory_ratio: maxPeakMemoryRatio,
				output_equivalent: outputEquivalent,
				paired_runs: pairs.length,
				phase,
				qualifies,
				stable,
			});
		}
	}
	return { baseline_variant: baselineVariant, candidate_variant: candidateVariant, qualifies: reports.every(report => report.qualifies), reports };
}

async function loadProfiles(inputDirectory: string): Promise<WorkloadProfile[]> {
	const profiles: WorkloadProfile[] = [];
	const glob = new Bun.Glob("**/profiles/*.json");
	for await (const relativePath of glob.scan({ cwd: inputDirectory, onlyFiles: true })) {
		const profilePath = path.join(inputDirectory, relativePath);
		const profile = (await Bun.file(profilePath).json()) as WorkloadProfile;
		const ttftMode = profile.phase.match(/^ttft-(cold|warm)-software$/)?.[1] as "cold" | "warm" | undefined;
		if (ttftMode) {
			const metricPath = path.join(path.dirname(path.dirname(profilePath)), "metrics", `ttft-${ttftMode}.json`);
			const metric = (await Bun.file(metricPath).json()) as Record<string, { ttft_ms: number }>;
			profile.duration_seconds = metric[ttftMode].ttft_ms / 1000;
		}
		profiles.push(profile);
	}
	return profiles;
}

function renderSummary(report: QualificationReport): string {
	const rows = report.reports.map(item =>
		`| ${item.phase} | ${item.cache_state} | ${item.paired_runs} | ${item.baseline_median_seconds.toFixed(3)} | ${item.candidate_median_seconds.toFixed(3)} | ${item.baseline_p95_seconds.toFixed(3)} | ${item.candidate_p95_seconds.toFixed(3)} | ${(item.max_peak_memory_ratio * 100).toFixed(1)}% | ${item.qualifies ? "pass" : "fail"} |`,
	);
	return [
		"### Bun performance qualification",
		"",
		"| Phase | Cache | Pairs | Baseline median (s) | Candidate median (s) | Baseline p95 (s) | Candidate p95 (s) | Peak memory | Result |",
		"| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
		...rows,
		"",
		`Overall: **${report.qualifies ? "pass" : "fail"}**`,
		"",
	].join("\n");
}

if (import.meta.main) {
	const inputIndex = process.argv.indexOf("--input");
	const outputIndex = process.argv.indexOf("--out");
	const inputDirectory = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
	const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
	if (!inputDirectory || !outputPath) {
		console.error("usage: validate-performance-qualification.ts --input <directory> --out <report.json>");
		process.exit(2);
	}
	const profiles = await loadProfiles(inputDirectory);
	const report = evaluateQualification(profiles);
	await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
	const summary = renderSummary(report);
	console.log(summary);
	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
	if (!report.qualifies) process.exit(1);
}
