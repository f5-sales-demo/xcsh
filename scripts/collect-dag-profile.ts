#!/usr/bin/env bun

import * as path from "node:path";
import { loadProfiles, type WorkloadProfile } from "./validate-performance-qualification";

export interface WorkflowJob {
	completed_at: string | null;
	conclusion: string | null;
	name: string;
	started_at: string | null;
}

interface WorkflowJobsResponse {
	jobs: WorkflowJob[];
}

export interface DagProfileOptions {
	cacheState: "cold" | "warm";
	jobPrefixes: readonly string[];
	pairId: string;
	sourceSha: string;
	variant: "dag-control" | "dag-candidate";
}

function sha256(value: string): string {
	return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

export function createDagProfile(
	profiles: readonly WorkloadProfile[],
	jobs: readonly WorkflowJob[],
	options: DagProfileOptions,
): WorkloadProfile {
	const selectedJobs = options.jobPrefixes.map(prefix => {
		const matches = jobs.filter(job => job.name.startsWith(prefix));
		if (matches.length !== 1) throw new Error(`expected exactly one workflow job beginning ${JSON.stringify(prefix)}`);
		return matches[0] as WorkflowJob;
	});
	if (selectedJobs.some(job => job.conclusion !== "success" || !job.started_at || !job.completed_at)) {
		throw new Error("DAG workload jobs must all be completed successfully");
	}

	const selectedProfiles = profiles.filter(
		profile =>
			profile.variant === options.variant &&
			profile.cache_state === options.cacheState &&
			profile.pair_id === options.pairId,
	);
	const requiredPhases = ["install", "native", "test-typescript", "test-rust"];
	for (const phase of requiredPhases) {
		if (!selectedProfiles.some(profile => profile.phase === phase)) throw new Error(`missing DAG phase profile: ${phase}`);
	}
	if (selectedProfiles.some(profile => profile.commit !== options.sourceSha)) throw new Error("DAG source SHA drift");
	const imageDigests = new Set(selectedProfiles.map(profile => profile.image_digest));
	if (imageDigests.size !== 1 || imageDigests.has(null)) throw new Error("DAG jobs did not use one immutable image digest");

	const started = Math.min(...selectedJobs.map(job => Date.parse(job.started_at as string)));
	const completed = Math.max(...selectedJobs.map(job => Date.parse(job.completed_at as string)));
	const digestInput = selectedProfiles
		.filter(profile => requiredPhases.includes(profile.phase))
		.map(profile => `${profile.phase}:${profile.output_digest ?? ""}`)
		.sort()
		.join("\n");
	const eventNames = new Set(selectedProfiles.flatMap(profile => Object.keys(profile.memory.events)));
	const events = Object.fromEntries(
		[...eventNames].map(name => [name, selectedProfiles.reduce((sum, profile) => sum + (profile.memory.events[name] ?? 0), 0)]),
	);

	return {
		cache_state: options.cacheState,
		commit: options.sourceSha,
		duration_seconds: (completed - started) / 1000,
		exit: { code: 0, signal: null },
		image_digest: [...imageDigests][0] as string,
		memory: {
			events,
			peak_bytes: Math.max(...selectedProfiles.map(profile => profile.memory.peak_bytes ?? 0)),
			peak_limit_ratio: Math.max(...selectedProfiles.map(profile => profile.memory.peak_limit_ratio ?? 1)),
		},
		output_digest: `sha256:${sha256(digestInput)}`,
		pair_id: options.pairId,
		phase: "workflow-critical-path",
		variant: options.variant,
	};
}

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index < 0 ? undefined : process.argv[index + 1];
}

if (import.meta.main) {
	const inputDirectory = argument("--input");
	const jobsPath = argument("--jobs");
	const outputPath = argument("--out");
	const sourceSha = argument("--source-sha");
	const cacheState = argument("--cache-state");
	const pairId = argument("--pair-id");
	const variant = argument("--variant");
	if (
		!inputDirectory ||
		!jobsPath ||
		!outputPath ||
		!sourceSha ||
		!pairId ||
		(cacheState !== "cold" && cacheState !== "warm") ||
		(variant !== "dag-control" && variant !== "dag-candidate")
	) {
		console.error(
			"usage: collect-dag-profile.ts --input <dir> --jobs <json> --variant <dag-control|dag-candidate> --source-sha <sha> --cache-state <cold|warm> --pair-id <id> --out <profile.json>",
		);
		process.exit(2);
	}
	const jobPrefixes =
		variant === "dag-control"
			? ["DAG control serial workload / "]
			: ["DAG candidate native / ", "DAG candidate Rust / ", "DAG candidate TypeScript / "];
	const jobs = (await Bun.file(jobsPath).json()) as WorkflowJobsResponse;
	const profile = createDagProfile(await loadProfiles(inputDirectory), jobs.jobs, {
		cacheState,
		jobPrefixes,
		pairId,
		sourceSha,
		variant,
	});
	await Bun.write(path.resolve(outputPath), `${JSON.stringify(profile, null, 2)}\n`);
}
