#!/usr/bin/env bun

import os from "node:os";
import path from "node:path";
import {
	buildApiCatalogDiscoveryCorpus,
	rankBaselineCatalogDiscovery,
	rankQmdBm25CatalogDiscovery,
} from "../src/internal-urls/api-catalog-discovery";
import { API_CATALOG_DATA, API_CATALOG_INDEX } from "../src/internal-urls/api-catalog-index.generated";
import { QMD_API_CATALOG_PREBUILT_INDEX } from "../src/internal-urls/api-catalog-qmd-index.generated";

interface Query {
	id: string;
	split: "tuning" | "sealed";
	class: string;
	query: string;
	expectedCategories: string[];
}

function score(queries: readonly Query[], ranked: ReadonlyMap<string, readonly string[]>) {
	let recallAt1 = 0;
	let recallAt3 = 0;
	let recallAt5 = 0;
	let reciprocalRank = 0;
	const misses: string[] = [];
	for (const query of queries) {
		const expected = new Set(query.expectedCategories);
		const actual = ranked.get(query.id) ?? [];
		const firstMatch = actual.findIndex(category => expected.has(category));
		if (expected.size === 0) {
			if (actual.length === 0) recallAt1++, recallAt3++, recallAt5++, reciprocalRank++;
			else misses.push(query.id);
			continue;
		}
		if (firstMatch === 0) recallAt1++;
		if (firstMatch >= 0 && firstMatch < 3) recallAt3++;
		if (firstMatch >= 0 && firstMatch < 5) recallAt5++;
		if (firstMatch >= 0) reciprocalRank += 1 / (firstMatch + 1);
		else misses.push(query.id);
	}
	return { recallAt1: recallAt1 / queries.length, recallAt3: recallAt3 / queries.length, recallAt5: recallAt5 / queries.length, mrr: reciprocalRank / queries.length, misses };
}

const fixture = (await Bun.file(path.join(import.meta.dir, "fixtures/api-catalog-retrieval-v1.json")).json()) as { queries: Query[] };
const corpus = buildApiCatalogDiscoveryCorpus(API_CATALOG_INDEX, API_CATALOG_DATA);
const cacheRoot = process.env.XCSH_QMD_BENCH_CACHE_ROOT ?? path.join(os.tmpdir(), "xcsh-qmd-benchmark");
const baseline = new Map<string, readonly string[]>();
const qmd = new Map<string, readonly string[]>();
const baselineStarted = performance.now();
for (const query of fixture.queries) baseline.set(query.id, rankBaselineCatalogDiscovery(query.query, corpus).map(candidate => candidate.categoryName));
const qmdStarted = performance.now();
for (const query of fixture.queries) {
	qmd.set(query.id, (await rankQmdBm25CatalogDiscovery(query.query, { cacheRoot, prebuiltIndex: QMD_API_CATALOG_PREBUILT_INDEX, limit: 5 })).map(candidate => candidate.categoryName));
}
console.log(JSON.stringify({
	corpus: { documents: corpus.documents.length, fingerprint: QMD_API_CATALOG_PREBUILT_INDEX.fingerprint },
	baselineElapsedMs: Math.round(qmdStarted - baselineStarted),
	qmdElapsedMs: Math.round(performance.now() - qmdStarted),
	baseline: score(fixture.queries, baseline),
	qmdBm25: score(fixture.queries, qmd),
}, null, 2));

