#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createStore } from "@tobilu/qmd";
import { evaluateHybridQualification } from "./knowledge-qualification";
import { buildApiOperationDiscoveryCorpus } from "../src/internal-urls/api-catalog-discovery";
import { API_CATALOG_DATA, API_CATALOG_INDEX } from "../src/internal-urls/api-catalog-index.generated";
import {
	buildKnowledgeSearchPlan,
	classifyKnowledgeRequest,
	type KnowledgeClassifierResource,
} from "../src/internal-urls/knowledge-classifier";
import { QMD_API_CATALOG_PREBUILT_INDEX } from "../src/internal-urls/api-catalog-qmd-index.generated";

interface ApiQuery {
	id: string;
	split: "tuning" | "sealed";
	class: string;
	query: string;
	expectedCategories: string[];
}

interface DocumentationQuery {
	id: string;
	split: "tuning" | "sealed";
	query: string;
	source: "docs-cloud-f5-com" | "my-f5-com";
	relevance: Record<string, number>;
}

interface ClassifierQuery {
	split: "tuning" | "sealed";
	prompt: string;
	expectedRoute: "api" | "documentation" | "none";
	source?: "docs-cloud-f5-com" | "my-f5-com";
	resource?: KnowledgeClassifierResource;
}

interface Ranked {
	readonly displayPath: string;
	readonly body?: string;
}

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index < 0 ? undefined : process.argv[index + 1];
}

function percentile(values: readonly number[], quantile: number): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function category(result: Ranked): string | null {
	return /^- Destination: xcsh:\/\/api-catalog\/([^\s]+)$/m.exec(result.body ?? "")?.[1] ?? null;
}

function documentationPath(result: Ranked, source: string): string | null {
	const prefix = `${source}/`;
	const suffix = "/index.md";
	return result.displayPath.startsWith(prefix) && result.displayPath.endsWith(suffix)
		? result.displayPath.slice(prefix.length, -suffix.length)
		: null;
}

function rankOf(actual: readonly string[], expected: ReadonlySet<string>): number {
	const position = actual.findIndex(value => expected.has(value));
	return position < 0 ? 0 : position + 1;
}

function apiMetrics(rows: readonly ApiQuery[], rankings: ReadonlyMap<string, readonly string[]>) {
	let recallAt1 = 0;
	let reciprocalRank = 0;
	for (const row of rows) {
		const rank = rankOf(rankings.get(row.id) ?? [], new Set(row.expectedCategories));
		if (rank === 1) recallAt1++;
		if (rank > 0) reciprocalRank += 1 / rank;
	}
	return { recallAt1: recallAt1 / rows.length, mrr: reciprocalRank / rows.length };
}

function documentationMetrics(
	rows: readonly DocumentationQuery[],
	rankings: ReadonlyMap<string, readonly string[]>,
) {
	let ndcgAt5 = 0;
	let reciprocalRank = 0;
	for (const row of rows) {
		const ranked = rankings.get(row.id) ?? [];
		let dcg = 0;
		for (let index = 0; index < Math.min(5, ranked.length); index++) {
			const grade = row.relevance[ranked[index]!] ?? 0;
			dcg += (2 ** grade - 1) / Math.log2(index + 2);
		}
		const ideal = Object.values(row.relevance)
			.sort((left, right) => right - left)
			.slice(0, 5)
			.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
		ndcgAt5 += ideal === 0 ? 1 : dcg / ideal;
		const rank = ranked.findIndex(value => (row.relevance[value] ?? 0) > 0);
		if (rank >= 0) reciprocalRank += 1 / (rank + 1);
	}
	return { ndcgAt5: ndcgAt5 / rows.length, mrr: reciprocalRank / rows.length };
}

async function sha256File(filePath: string): Promise<string> {
	return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const modelPath = argument("--model");
const documentationIndex = argument("--documentation-index");
const outputPath = argument("--output") ?? path.join(os.tmpdir(), "xcsh-qmd-hybrid-report.json");
if (!modelPath || !documentationIndex) {
	throw new Error("--model PATH and --documentation-index PATH are required");
}
const manifest = (await Bun.file(path.join(import.meta.dir, "../../../tools/qmd-models.json")).json()) as {
	embedding: { sha256: string; size_bytes: number; commit: string; license: string };
	qmd: { version: string; source_commit: string };
	native_runtime: Record<string, string>;
};
if ((await sha256File(modelPath)) !== manifest.embedding.sha256) throw new Error("embedding model checksum mismatch");
if (manifest.embedding.license !== "apache-2.0") throw new Error("embedding model license mismatch");

const fixture = (await Bun.file(path.join(import.meta.dir, "fixtures/knowledge-evaluation-v2.json")).json()) as {
	seed: number;
	api: ApiQuery[];
	documentation: DocumentationQuery[];
	classifier: ClassifierQuery[];
};
const apiRows = fixture.api.filter(row => row.split === "sealed");
const documentationRows = fixture.documentation.filter(row => row.split === "sealed");
const root = await mkdtemp(path.join(os.tmpdir(), "xcsh-qmd-hybrid-"));
const baselineApiPath = path.join(root, "api-baseline.sqlite");
const candidateApiPath = path.join(root, "api-candidate.sqlite");
const candidateApiDocuments = path.join(root, "api-operation-documents");
const docsPath = path.join(root, "documentation.sqlite");
await Bun.write(
	baselineApiPath,
	gunzipSync(Buffer.from(QMD_API_CATALOG_PREBUILT_INDEX.gzipBase64, "base64")),
);
await mkdir(candidateApiDocuments, { recursive: true });
const fixedTime = new Date("2000-01-01T00:00:00.000Z");
for (const document of buildApiOperationDiscoveryCorpus(API_CATALOG_INDEX, API_CATALOG_DATA).documents) {
	const identity = createHash("sha256").update(document.id).digest("hex").slice(0, 16);
	const documentPath = path.join(candidateApiDocuments, `${document.categoryName}-${identity}.md`);
	await writeFile(documentPath, document.markdown, "utf8");
	await utimes(documentPath, fixedTime, fixedTime);
}
await copyFile(documentationIndex, docsPath);

const baselineApiStore = await createStore({ dbPath: baselineApiPath, readonly: true });
const candidateApiStore = await createStore({
	dbPath: candidateApiPath,
	config: { collections: { catalog: { path: candidateApiDocuments, pattern: "*.md" } } },
});
await candidateApiStore.update();
const docsStore = await createStore({ dbPath: docsPath });
try {
	const apiEmbed = await candidateApiStore.embed({ force: true, model: modelPath, chunkStrategy: "regex" });
	const docsEmbed = await docsStore.embed({ force: true, model: modelPath, chunkStrategy: "regex" });
	if (apiEmbed.errors || docsEmbed.errors) throw new Error("vector generation reported failed chunks");

	const baselineApi = new Map<string, readonly string[]>();
	const candidateApi = new Map<string, readonly string[]>();
	const baselineDocs = new Map<string, readonly string[]>();
	const candidateDocs = new Map<string, readonly string[]>();
	const baselineTimes: number[] = [];
	const candidateTimes: number[] = [];

	await candidateApiStore.search({
		queries: [{ type: "vec", query: "F5 Distributed Cloud DNS zone API" }],
		limit: 1,
		rerank: false,
	});

	for (const row of apiRows) {
		let started = performance.now();
		const baseline = await baselineApiStore.searchLex(row.query, { limit: 5, collection: "catalog" });
		baselineTimes.push(performance.now() - started);
		baselineApi.set(row.id, [...new Set(baseline.map(category).filter(value => value !== null))]);

		const plan = buildKnowledgeSearchPlan("api", row.query);
		started = performance.now();
		const candidate = await candidateApiStore.search({
			queries: [
				{ type: "lex", query: row.query },
				...plan.vec.map(query => ({ type: "vec" as const, query })),
				...plan.hyde.map(query => ({ type: "hyde" as const, query })),
			],
			intent: plan.intent,
			collections: ["catalog"],
			limit: 5,
			candidateLimit: 30,
			minScore: 0.2,
			explain: true,
			rerank: false,
		});
		candidateTimes.push(performance.now() - started);
		candidateApi.set(row.id, [...new Set(candidate.map(category).filter(value => value !== null))]);
	}

	for (const row of documentationRows) {
		let started = performance.now();
		const baseline = await docsStore.searchLex(row.query, { limit: 5, collection: row.source });
		baselineTimes.push(performance.now() - started);
		baselineDocs.set(
			row.id,
			baseline.map(result => documentationPath(result, row.source)).filter(value => value !== null),
		);

		const plan = buildKnowledgeSearchPlan("documentation", row.query);
		started = performance.now();
		const candidate = await docsStore.search({
			queries: [
				{ type: "lex", query: row.query },
				...plan.vec.map(query => ({ type: "vec" as const, query })),
				...plan.hyde.map(query => ({ type: "hyde" as const, query })),
			],
			intent: plan.intent,
			collections: [row.source],
			limit: 5,
			candidateLimit: 30,
			minScore: 0.25,
			explain: true,
			rerank: false,
		});
		candidateTimes.push(performance.now() - started);
		candidateDocs.set(
			row.id,
			candidate.map(result => documentationPath(result, row.source)).filter(value => value !== null),
		);
	}

	const apiBaseline = apiMetrics(apiRows, baselineApi);
	const apiCandidate = apiMetrics(apiRows, candidateApi);
	const docsBaseline = documentationMetrics(documentationRows, baselineDocs);
	const docsCandidate = documentationMetrics(documentationRows, candidateDocs);
	const exactNoRegression = apiRows
		.filter(row => ["operation-id", "path", "exact-name"].includes(row.class))
		.every(row => {
			const expected = new Set(row.expectedCategories);
			const baselineRank = rankOf(baselineApi.get(row.id) ?? [], expected);
			const candidateRank = rankOf(candidateApi.get(row.id) ?? [], expected);
			return baselineRank === 0 ? candidateRank > 0 : candidateRank > 0 && candidateRank <= baselineRank;
		});
	const candidateP95 = percentile(candidateTimes, 0.95);
	const baselineP95 = percentile(baselineTimes, 0.95);
	let truePositive = 0;
	let falsePositive = 0;
	let falseNegative = 0;
	let sealedNoMatchFalsePositives = 0;
	for (const row of fixture.classifier.filter(candidate => candidate.split === "sealed")) {
		const actual = classifyKnowledgeRequest(row.prompt, {
			toolsEnabled: true,
			resources: row.resource ? [row.resource] : [],
			documentationSource: row.source,
		});
		const expectedPositive = row.expectedRoute !== "none";
		const actualPositive = actual.route !== "none";
		if (expectedPositive && actual.route === row.expectedRoute) truePositive++;
		else if (expectedPositive) falseNegative++;
		else if (actualPositive) falsePositive++, sealedNoMatchFalsePositives++;
	}
	const classifierPrecision = truePositive / Math.max(1, truePositive + falsePositive);
	const classifierRecall = truePositive / Math.max(1, truePositive + falseNegative);
	const vectorFingerprint = createHash("sha256")
		.update(
			JSON.stringify({
				model: manifest.embedding.sha256,
				qmd: manifest.qmd,
				apiIndex: await sha256File(candidateApiPath),
				docsIndex: await sha256File(docsPath),
			}),
		)
		.digest("hex");
	const measured = {
		exactNoRegression,
		apiRecallAt1Gain: apiCandidate.recallAt1 - apiBaseline.recallAt1,
		apiMrrGain: apiCandidate.mrr - apiBaseline.mrr,
		documentationNdcgAt5Gain: docsCandidate.ndcgAt5 - docsBaseline.ndcgAt5,
		documentationMrrGain: docsCandidate.mrr - docsBaseline.mrr,
		classifierPrecision,
		classifierRecall,
		sealedNoMatchFalsePositives,
		compressedBytes: manifest.embedding.size_bytes,
		warmRetrievalP95Ms: candidateP95,
		// End-to-end qualification is intentionally not run after retrieval gates
		// fail. Sentinel values make this fail closed rather than imply evidence.
		endToEndBaselineMedianMs: 0,
		endToEndCandidateMedianMs: Number.MAX_SAFE_INTEGER,
		endToEndBaselineP95Ms: 0,
		endToEndCandidateP95Ms: Number.MAX_SAFE_INTEGER,
	};
	const qualification = evaluateHybridQualification(measured);
	const report = {
		schemaVersion: 1,
		seed: fixture.seed,
		candidate: "bm25+nomic-embed-text-v1.5-q8",
		model: manifest.embedding,
		qmd: manifest.qmd,
		nativeRuntime: manifest.native_runtime,
		vectorFingerprint,
		counts: { api: apiRows.length, documentation: documentationRows.length },
		metrics: {
			apiBaseline,
			apiCandidate,
			docsBaseline,
			docsCandidate,
			baselineP95,
			candidateP95,
			classifierPrecision,
			classifierRecall,
			sealedNoMatchFalsePositives,
		},
		qualification,
		reranker: { evaluated: false, reason: "vector prerequisite did not qualify" },
	};
	await Bun.write(outputPath, `${JSON.stringify(report, null, "\t")}\n`);
	console.log(JSON.stringify(report, null, 2));
	if (!qualification.vectorQualifies) process.exitCode = 2;
} finally {
	await baselineApiStore.close();
	await candidateApiStore.close();
	await docsStore.close();
	await rm(root, { recursive: true, force: true });
}
