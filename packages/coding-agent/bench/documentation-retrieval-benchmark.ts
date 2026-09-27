#!/usr/bin/env bun

import os from "node:os";
import path from "node:path";
import { EMBEDDED_DOCUMENTATION_ASSETS } from "../src/internal-urls/documentation-assets.generated";
import { createEmbeddedDocumentationRepository } from "../src/internal-urls/documentation-repository";
import type { DocumentationSource } from "../src/internal-urls/documentation-resolve";
import { fixedSeedPairwiseOrder } from "./model-scenarios";

interface QualificationInput {
	readonly candidateMilliseconds: readonly number[];
	readonly baselineMilliseconds: readonly number[];
	readonly memoryRatios: readonly number[];
	readonly relevancePassed: boolean;
	readonly integrityPassed: boolean;
	readonly apiRegressionPassed: boolean;
}

export interface DocumentationQualification {
	readonly candidateMedianMilliseconds: number;
	readonly baselineMedianMilliseconds: number;
	readonly candidateP95Milliseconds: number;
	readonly baselineP95Milliseconds: number;
	readonly medianImprovementRatio: number;
	readonly maxMemoryRatio: number;
	readonly relevancePassed: boolean;
	readonly integrityPassed: boolean;
	readonly apiRegressionPassed: boolean;
	readonly pairedRunsPassed: boolean;
	readonly qualifies: boolean;
}

interface FixtureScenario {
	readonly id: string;
	readonly query: string;
	readonly source?: DocumentationSource;
	readonly expectedPath?: string;
	readonly maxRank?: number;
	readonly requiredSources?: readonly DocumentationSource[];
	readonly expectNoResults?: boolean;
	readonly liveUrl?: string;
}

interface Fixture {
	readonly schemaVersion: 1;
	readonly seed: number;
	readonly scenarios: readonly FixtureScenario[];
}

function percentile(values: readonly number[], quantile: number): number {
	if (values.length === 0) return Number.POSITIVE_INFINITY;
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1))]!;
}

function median(values: readonly number[]): number {
	if (values.length === 0) return Number.POSITIVE_INFINITY;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

export function evaluateDocumentationQualification(input: QualificationInput): DocumentationQualification {
	const candidateMedianMilliseconds = median(input.candidateMilliseconds);
	const baselineMedianMilliseconds = median(input.baselineMilliseconds);
	const candidateP95Milliseconds = percentile(input.candidateMilliseconds, 0.95);
	const baselineP95Milliseconds = percentile(input.baselineMilliseconds, 0.95);
	const medianImprovementRatio =
		baselineMedianMilliseconds > 0
			? (baselineMedianMilliseconds - candidateMedianMilliseconds) / baselineMedianMilliseconds
			: Number.NEGATIVE_INFINITY;
	const maxMemoryRatio = input.memoryRatios.length > 0 ? Math.max(...input.memoryRatios) : Number.POSITIVE_INFINITY;
	const pairedRunsPassed =
		input.candidateMilliseconds.length >= 5 &&
		input.candidateMilliseconds.length === input.baselineMilliseconds.length;
	return {
		candidateMedianMilliseconds,
		baselineMedianMilliseconds,
		candidateP95Milliseconds,
		baselineP95Milliseconds,
		medianImprovementRatio,
		maxMemoryRatio,
		relevancePassed: input.relevancePassed,
		integrityPassed: input.integrityPassed,
		apiRegressionPassed: input.apiRegressionPassed,
		pairedRunsPassed,
		qualifies:
			pairedRunsPassed &&
			input.relevancePassed &&
			input.integrityPassed &&
			input.apiRegressionPassed &&
			medianImprovementRatio >= 0.2 &&
			candidateP95Milliseconds <= baselineP95Milliseconds &&
			maxMemoryRatio < 0.8,
	};
}

function readValue(args: readonly string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index < 0 ? undefined : args[index + 1];
}

async function run(): Promise<void> {
	if (!EMBEDDED_DOCUMENTATION_ASSETS) {
		throw new Error("Generate the embedded documentation index before running this benchmark");
	}
	const fixture = (await Bun.file(path.join(import.meta.dir, "fixtures/documentation-retrieval-v1.json")).json()) as Fixture;
	if (fixture.schemaVersion !== 1 || fixture.scenarios.length === 0) throw new Error("invalid benchmark fixture");
	const requestedRuns = Number(readValue(process.argv, "--runs") ?? "5");
	if (!Number.isSafeInteger(requestedRuns) || requestedRuns < 5) throw new Error("--runs must be an integer of at least 5");
	const apiRegressionPassed = process.argv.includes("--api-regression-passed");
	const createdAt = new Date().toISOString();
	const outputPath = path.resolve(
		readValue(process.argv, "--out") ??
			path.join(os.homedir(), ".xcsh", "benchmarks", `documentation-retrieval-${createdAt.replaceAll(":", "-")}.json`),
	);
	const repository = createEmbeddedDocumentationRepository(EMBEDDED_DOCUMENTATION_ASSETS, {
		cacheRoot: path.join(os.homedir(), ".xcsh", "cache", "documentation-benchmark"),
	});
	await repository.prime();
	const samples: Array<Record<string, unknown>> = [];
	const candidateMilliseconds: number[] = [];
	const baselineMilliseconds: number[] = [];
	const memoryRatios: number[] = [];
	let relevancePassed = true;
	let integrityPassed = true;
	for (let run = 1; run <= requestedRuns; run++) {
		for (const scenario of fixedSeedPairwiseOrder(fixture.scenarios, fixture.seed + run)) {
			const candidateStarted = performance.now();
			const results = await repository.search(scenario.query, scenario.source, 5);
			let documentBytes = 0;
			if (scenario.expectedPath) {
				const document = await repository.readDocument(scenario.source ?? "docs-cloud-f5-com", scenario.expectedPath);
				documentBytes = document ? Buffer.byteLength(document.markdown, "utf8") : 0;
				integrityPassed &&= documentBytes > 0;
			}
			const candidateElapsed = performance.now() - candidateStarted;
			const rank = scenario.expectedPath
				? results.findIndex(result => result.stablePath === scenario.expectedPath) + 1
				: 0;
			const sources = new Set(results.map(result => result.source));
			const relevant = scenario.expectNoResults
				? results.length === 0
				: rank > 0 && rank <= (scenario.maxRank ?? 1) && (scenario.requiredSources ?? []).every(source => sources.has(source));
			relevancePassed &&= relevant;
			const memoryRatio = process.memoryUsage().rss / os.totalmem();
			memoryRatios.push(memoryRatio);
			let baselineElapsed: number | null = null;
			let baselineStatus: number | null = null;
			let baselineBytes = 0;
			if (scenario.liveUrl) {
				const baselineStarted = performance.now();
				const response = await fetch(scenario.liveUrl, {
					cache: "no-store",
					headers: { "cache-control": "no-cache", connection: "close" },
					signal: AbortSignal.timeout(30_000),
				});
				const body = await response.arrayBuffer();
				baselineElapsed = performance.now() - baselineStarted;
				baselineStatus = response.status;
				baselineBytes = body.byteLength;
				integrityPassed &&= response.ok && baselineBytes > 0;
				candidateMilliseconds.push(candidateElapsed);
				baselineMilliseconds.push(baselineElapsed);
			}
			samples.push({
				run,
				scenarioId: scenario.id,
				candidateMilliseconds: candidateElapsed,
				baselineMilliseconds: baselineElapsed,
				baselineStatus,
				baselineBytes,
				documentBytes,
				rank,
				resultSources: [...sources].sort(),
				relevant,
				memoryRatio,
			});
		}
	}
	const qualification = evaluateDocumentationQualification({
		candidateMilliseconds,
		baselineMilliseconds,
		memoryRatios,
		relevancePassed,
		integrityPassed,
		apiRegressionPassed,
	});
	const report = {
		schemaVersion: 1,
		createdAt,
		releaseTag: EMBEDDED_DOCUMENTATION_ASSETS.releaseTag,
		fingerprint: EMBEDDED_DOCUMENTATION_ASSETS.fingerprint,
		seed: fixture.seed,
		runs: requestedRuns,
		scenarios: fixture.scenarios,
		samples,
		qualification,
	};
	await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify({ outputPath, ...qualification }, null, 2));
	if (!qualification.qualifies) process.exitCode = 1;
}

if (import.meta.main) await run();
