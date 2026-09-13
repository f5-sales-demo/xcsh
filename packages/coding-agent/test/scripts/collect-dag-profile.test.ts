import { describe, expect, it } from "bun:test";
import { createDagProfile, type WorkflowJob } from "../../../../scripts/collect-dag-profile";
import type { WorkloadProfile } from "../../../../scripts/validate-performance-qualification";

const SOURCE_SHA = "68721777f3a2fae473c9ee127539ad7139354040";
const IMAGE = `registry.example/runner@sha256:${"a".repeat(64)}`;

function profile(phase: string, variant: "dag-control" | "dag-candidate"): WorkloadProfile {
	return {
		cache_state: "cold",
		commit: SOURCE_SHA,
		duration_seconds: 10,
		exit: { code: 0, signal: null },
		image_digest: IMAGE,
		memory: { events: { oom: 0, oom_kill: 0 }, peak_bytes: 1024, peak_limit_ratio: 0.5 },
		output_digest: `sha256:${phase}`,
		pair_id: "1",
		phase,
		variant,
	};
}

function job(name: string, start: string, end: string): WorkflowJob {
	return { completed_at: end, conclusion: "success", name, started_at: start };
}

describe("workflow DAG critical-path profile", () => {
	it("compares one serial job with native-to-TypeScript and independent Rust jobs", () => {
		const phases = ["install", "native", "test-typescript", "test-rust"];
		const control = createDagProfile(
			phases.map(phase => profile(phase, "dag-control")),
			[job("DAG control serial workload / cold / pair-1", "2026-09-10T10:00:00Z", "2026-09-10T10:10:00Z")],
			{
				cacheState: "cold",
				jobPrefixes: ["DAG control serial workload / "],
				pairId: "1",
				sourceSha: SOURCE_SHA,
				variant: "dag-control",
			},
		);
		const candidate = createDagProfile(
			[
				...phases.map(phase => profile(phase, "dag-candidate")),
				profile("install-rust", "dag-candidate"),
				profile("install-typescript", "dag-candidate"),
			],
			[
				job("DAG candidate native / cold / pair-1", "2026-09-10T10:00:00Z", "2026-09-10T10:04:00Z"),
				job("DAG candidate Rust / cold / pair-1", "2026-09-10T10:00:10Z", "2026-09-10T10:05:00Z"),
				job("DAG candidate TypeScript / cold / pair-1", "2026-09-10T10:04:10Z", "2026-09-10T10:08:00Z"),
			],
			{
				cacheState: "cold",
				jobPrefixes: ["DAG candidate native / ", "DAG candidate Rust / ", "DAG candidate TypeScript / "],
				pairId: "1",
				sourceSha: SOURCE_SHA,
				variant: "dag-candidate",
			},
		);

		expect(control.duration_seconds).toBe(600);
		expect(candidate.duration_seconds).toBe(480);
		expect(candidate.output_digest).toBe(control.output_digest);
	});

	it("rejects mixed image identities", () => {
		const profiles = ["install", "native", "test-typescript", "test-rust"].map(phase =>
			profile(phase, "dag-control"),
		);
		(profiles[0] as WorkloadProfile).image_digest = `registry.example/runner@sha256:${"b".repeat(64)}`;
		expect(() =>
			createDagProfile(
				profiles,
				[job("DAG control serial workload / cold / pair-1", "2026-09-10T10:00:00Z", "2026-09-10T10:10:00Z")],
				{
					cacheState: "cold",
					jobPrefixes: ["DAG control serial workload / "],
					pairId: "1",
					sourceSha: SOURCE_SHA,
					variant: "dag-control",
				},
			),
		).toThrow("one immutable image digest");
	});
});
