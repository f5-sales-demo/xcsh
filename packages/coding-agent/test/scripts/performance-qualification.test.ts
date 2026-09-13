import { describe, expect, it } from "bun:test";
import {
	evaluateQualification,
	nearestRankP95,
	REQUIRED_PHASES,
	type WorkloadProfile,
} from "../../../../scripts/validate-performance-qualification";

const SOURCE_SHA = "68721777f3a2fae473c9ee127539ad7139354040";

function profile(
	phase: string,
	cacheState: "cold" | "warm",
	variant: "d16-serial" | "d16-parallel-2",
	pair: number,
	durationSeconds: number,
): WorkloadProfile {
	return {
		cache_state: cacheState,
		commit: SOURCE_SHA,
		duration_seconds: durationSeconds,
		exit: { code: 0, signal: null },
		image_digest: `registry.example/runner@sha256:${"a".repeat(64)}`,
		memory: { events: { oom: 0, oom_kill: 0 }, peak_bytes: 1024, peak_limit_ratio: 0.5 },
		output_digest: `sha256:${phase}`,
		pair_id: String(pair),
		phase,
		variant,
	};
}

function completeMatrix(): WorkloadProfile[] {
	const profiles: WorkloadProfile[] = [];
	for (const phase of REQUIRED_PHASES) {
		for (const cacheState of ["cold", "warm"] as const) {
			for (let pair = 1; pair <= 5; pair += 1) {
				profiles.push(profile(phase, cacheState, "d16-serial", pair, 10 + pair));
				profiles.push(profile(phase, cacheState, "d16-parallel-2", pair, 7 + pair * 0.6));
			}
		}
	}
	return profiles;
}

describe("performance qualification", () => {
	it("uses the nearest-rank p95", () => {
		expect(nearestRankP95([1, 2, 3, 4, 5])).toBe(5);
		expect(nearestRankP95([10, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(10);
	});

	it("requires five source-identical matched cold and warm samples", () => {
		const report = evaluateQualification(completeMatrix(), {
			baselineVariant: "d16-serial",
			candidateVariant: "d16-parallel-2",
			expectedSourceCommit: SOURCE_SHA,
			targetPhases: ["test-typescript"],
		});
		expect(report.qualifies).toBe(true);
		expect(report.reports).toHaveLength(REQUIRED_PHASES.length * 2);
		expect(report.reports.every(item => item.paired_runs === 5)).toBe(true);
		expect(
			report.reports.find(item => item.phase === "test-typescript")?.median_improvement_ratio,
		).toBeGreaterThanOrEqual(0.2);
	});

	it("rejects source drift and less than twenty percent target improvement", () => {
		const profiles = completeMatrix();
		(profiles.find(item => item.variant === "d16-parallel-2") as WorkloadProfile).commit = "b".repeat(40);
		const drifted = evaluateQualification(profiles, {
			baselineVariant: "d16-serial",
			candidateVariant: "d16-parallel-2",
			expectedSourceCommit: SOURCE_SHA,
			targetPhases: ["test-typescript"],
		});
		expect(drifted.qualifies).toBe(false);

		const slow = completeMatrix();
		for (const item of slow) {
			if (item.variant === "d16-parallel-2" && item.phase === "test-typescript") item.duration_seconds = 12;
		}
		expect(
			evaluateQualification(slow, {
				baselineVariant: "d16-serial",
				candidateVariant: "d16-parallel-2",
				expectedSourceCommit: SOURCE_SHA,
				targetPhases: ["test-typescript"],
			}).qualifies,
		).toBe(false);
	});

	it("rejects p95 regression, output drift, OOM, and eighty-percent memory use", () => {
		const profiles = completeMatrix();
		const candidates = profiles.filter(
			item => item.phase === "test-typescript" && item.cache_state === "cold" && item.variant === "d16-parallel-2",
		);
		(candidates[0] as WorkloadProfile).duration_seconds = 100;
		(candidates[1] as WorkloadProfile).output_digest = "sha256:drift";
		(candidates[2] as WorkloadProfile).memory.events.oom_kill = 1;
		(candidates[3] as WorkloadProfile).memory.peak_limit_ratio = 0.8;
		const report = evaluateQualification(profiles, {
			baselineVariant: "d16-serial",
			candidateVariant: "d16-parallel-2",
			expectedSourceCommit: SOURCE_SHA,
			targetPhases: ["test-typescript"],
		});
		expect(report.qualifies).toBe(false);
		const testCold = report.reports.find(item => item.phase === "test-typescript" && item.cache_state === "cold");
		expect(testCold).toMatchObject({ output_equivalent: false, qualifies: false, stable: false });
		expect(testCold?.candidate_p95_seconds).toBeGreaterThan(testCold?.baseline_p95_seconds ?? 0);
		expect(testCold?.max_peak_memory_ratio).toBe(0.8);
	});

	it("evaluates an experiment-specific workflow critical path in addition to common phases", () => {
		const profiles = completeMatrix();
		for (const cacheState of ["cold", "warm"] as const) {
			for (let pair = 1; pair <= 5; pair += 1) {
				profiles.push(profile("workflow-critical-path", cacheState, "d16-serial", pair, 100 + pair));
				profiles.push(profile("workflow-critical-path", cacheState, "d16-parallel-2", pair, 75 + pair));
			}
		}
		const report = evaluateQualification(profiles, {
			baselineVariant: "d16-serial",
			candidateVariant: "d16-parallel-2",
			expectedSourceCommit: SOURCE_SHA,
			targetPhases: ["workflow-critical-path"],
		});
		expect(report.qualifies).toBe(true);
		expect(report.reports.filter(item => item.phase === "workflow-critical-path")).toHaveLength(2);
	});
});
