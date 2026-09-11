import { describe, expect, it } from "bun:test";
import {
	evaluateQualification,
	nearestRankP95,
	REQUIRED_PHASES,
	type WorkloadProfile,
} from "../../../../scripts/validate-performance-qualification";

function profile(
	phase: string,
	cacheState: "cold" | "warm",
	variant: "baseline" | "bun-1.4.2",
	pair: number,
	durationSeconds: number,
): WorkloadProfile {
	return {
		cache_state: cacheState,
		commit: variant === "baseline" ? "a".repeat(40) : "b".repeat(40),
		duration_seconds: durationSeconds,
		exit: { code: 0, signal: null },
		memory: { events: { oom: 0, oom_kill: 0 }, peak_bytes: 1024, peak_limit_ratio: 0.25 },
		output_digest: `sha256:${phase}`,
		pair_id: `software-${cacheState}-${pair}`,
		phase,
		variant,
	};
}

function completeMatrix(): WorkloadProfile[] {
	const profiles: WorkloadProfile[] = [];
	for (const phase of REQUIRED_PHASES) {
		for (const cacheState of ["cold", "warm"] as const) {
			for (let pair = 1; pair <= 5; pair += 1) {
				profiles.push(profile(phase, cacheState, "baseline", pair, 10 + pair));
				profiles.push(profile(phase, cacheState, "bun-1.4.2", pair, 9 + pair));
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

	it("requires five matched cold and warm samples for every phase", () => {
		const report = evaluateQualification(completeMatrix());
		expect(report.qualifies).toBe(true);
		expect(report.reports).toHaveLength(REQUIRED_PHASES.length * 2);
		expect(report.reports.every(item => item.paired_runs === 5)).toBe(true);
	});

	it("requires distinct, internally consistent frozen source identities", () => {
		const profiles = completeMatrix();
		const report = evaluateQualification(profiles, "baseline", "bun-1.4.2", "a".repeat(40), "b".repeat(40));
		expect(report.qualifies).toBe(true);
		expect(report.baseline_commit).toBe("a".repeat(40));
		expect(report.candidate_commit).toBe("b".repeat(40));

		(profiles.find(item => item.variant === "baseline") as WorkloadProfile).commit = "c".repeat(40);
		const drifted = evaluateQualification(profiles, "baseline", "bun-1.4.2", "a".repeat(40), "b".repeat(40));
		expect(drifted.qualifies).toBe(false);
		expect(drifted.reports.every(item => item.source_identity_valid === false)).toBe(true);
	});

	it("rejects p95 regression, output drift, OOM, and eighty-percent memory use", () => {
		const profiles = completeMatrix();
		const candidates = profiles.filter(
			item => item.phase === "startup-software" && item.cache_state === "cold" && item.variant === "bun-1.4.2",
		);
		(candidates[0] as WorkloadProfile).duration_seconds = 100;
		(candidates[1] as WorkloadProfile).output_digest = "sha256:drift";
		(candidates[2] as WorkloadProfile).memory.events.oom_kill = 1;
		(candidates[3] as WorkloadProfile).memory.peak_limit_ratio = 0.8;
		const report = evaluateQualification(profiles);
		expect(report.qualifies).toBe(false);
		const startupCold = report.reports.find(item => item.phase === "startup-software" && item.cache_state === "cold");
		expect(startupCold).toMatchObject({
			output_equivalent: false,
			qualifies: false,
			stable: false,
		});
		expect(startupCold?.candidate_p95_seconds).toBeGreaterThan(startupCold?.baseline_p95_seconds ?? 0);
		expect(startupCold?.max_peak_memory_ratio).toBe(0.8);
	});
});
