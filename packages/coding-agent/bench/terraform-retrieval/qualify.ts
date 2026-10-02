#!/usr/bin/env bun
import { readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	TerraformDocumentationRepository,
	type TerraformEmbeddedAssets,
	terraformHash,
} from "../../src/internal-urls/terraform-documentation";
import type { InternalUrl } from "../../src/internal-urls/types";
import { measureCompleteRetrieval } from "./complete-measurement";
import {
	scoreDestinations,
	type TerraformPreviewEvidence,
	validateIndependentFreeze,
	validatePreviewEvidence,
	validateQualificationEligibility,
	validateQualificationSource,
} from "./score";

interface Case {
	id: string;
	prompt: string;
	kind: "answerable" | "ambiguous" | "control";
	expected: string[];
	match_document?: boolean;
	behavior?: string;
	clarification?: string;
	depth?: number;
}
const root = import.meta.dir;
const arg = (name: string) => {
	const i = process.argv.indexOf(name);
	return i < 0 ? undefined : process.argv[i + 1];
};
const assetFile = arg("--assets");
if (!assetFile) throw new Error("--assets <JSON> required");
const assets = JSON.parse(await readFile(assetFile, "utf8")) as TerraformEmbeddedAssets;
const suiteFile = arg("--suite") ?? path.join(root, "heldout.json");
const output = arg("--output") ?? path.join(root, `qualification-${os.platform()}-${os.arch()}.json`);
const freeze = JSON.parse(await readFile(path.join(path.dirname(suiteFile), "freeze.json"), "utf8"));
const suiteBytes = await readFile(suiteFile);
const suiteName = path.basename(suiteFile);
if (terraformHash(suiteBytes) !== freeze.files[suiteName]) throw new Error("Frozen qualification suite hash mismatch");
const regression = process.argv.includes("--regression");
const previewFile = arg("--preview-evidence");
const preview = previewFile ? (JSON.parse(await readFile(previewFile, "utf8")) as TerraformPreviewEvidence) : undefined;
validatePreviewEvidence(preview, assets.pin.index.sha256, regression);
const reviewedPin = JSON.parse(
	await readFile(path.resolve(root, "../../../../tools/terraform-documentation-release.json"), "utf8"),
);
if (regression && reviewedPin.index?.sha256 !== assets.pin.index.sha256 && !preview)
	throw new Error("Changed regression index requires --preview-evidence for source provenance");

validateQualificationSource(freeze, assets.pin, regression);
const eligibilityPath = path.join(path.dirname(suiteFile), "eligibility.json");
const eligibility = (await Bun.file(eligibilityPath).exists())
	? JSON.parse(await readFile(eligibilityPath, "utf8"))
	: undefined;
validateQualificationEligibility(eligibility, terraformHash(suiteBytes), regression);

const suite = JSON.parse(suiteBytes.toString()) as Case[];
if (freeze.schema_version === 2) {
	const reviewBytes = await readFile(path.join(path.dirname(suiteFile), "independent-review.json"));
	const allCases = JSON.parse(await readFile(path.join(path.dirname(suiteFile), "heldout.json"), "utf8")) as Case[];
	validateIndependentFreeze(
		freeze,
		JSON.parse(reviewBytes.toString()),
		terraformHash(reviewBytes),
		allCases.map(c => c.id),
	);
}

const cache =
	arg("--cache") ?? path.join(os.tmpdir(), `xcsh-terraform-qualification-${terraformHash(suiteBytes).slice(0, 12)}`);
const repo = new TerraformDocumentationRepository(assets, cache);
const coldStart = performance.now();
await repo.database();
const materializationMs = performance.now() - coldStart;
const read = (uri: string) =>
	repo.resolve(Object.assign(new URL(uri), { rawHost: "terraform-documentation" }) as InternalUrl);
const normalize = (uri: string) => {
	const u = new URL(uri);
	u.search = "";
	return u.href;
};
const results = [];
const latency: number[] = [];
const contextLatency: number[] = [];
const routeLatency: number[] = [];
let totalBytes = 0;
let callCount = 0;
let maxBytes = 0;
let maxContextBytes = 0;
for (const c of suite) {
	const activated = c.behavior !== "ordinary-discovery";
	if (!activated) {
		results.push({ id: c.id, passed: null, behavior: c.behavior, requires_model_uat: true });
		continue;
	}
	const uri = `xcsh://terraform-documentation/?search=${encodeURIComponent(c.prompt)}`;
	const measured = await measureCompleteRetrieval(read, uri, 5);
	const times = measured.discoveryTimes,
		content = measured.discovery;
	latency.push(...times);
	contextLatency.push(...measured.contextTimes);
	routeLatency.push(...measured.routeTimes);
	callCount += measured.toolCalls;
	totalBytes += measured.totalBytes;
	maxBytes = Math.max(maxBytes, measured.maxDiscoveryBytes);
	maxContextBytes = Math.max(maxContextBytes, measured.maxContextBytes);
	const destinations = [...content.matchAll(/^Read: (\S+)/gm)].map(m => normalize(m[1]!));
	const selected = content.includes("Selected leaf;");
	const { rank, top5, matchedExpected, selectionCorrect } = scoreDestinations(
		c.kind,
		selected,
		destinations,
		c.expected,
		c.match_document,
	);
	const leafReadBytes = measured.context ? Buffer.byteLength(measured.context) : null;
	const unsupported = c.behavior === "unsupported";
	const passed =
		c.kind === "answerable"
			? selectionCorrect
			: c.kind === "ambiguous"
				? selectionCorrect
				: unsupported
					? content.includes("No results.")
					: null;
	results.push({
		id: c.id,
		kind: c.kind,
		passed,
		top5,
		rank,
		matched_expected: matchedExpected,
		selected,
		selection_correct: selectionCorrect,
		destinations,
		times_ms: times,
		route_times_ms: measured.routeTimes,
		response_sha256: measured.responseHash,
		response_bytes: Buffer.byteLength(content),
		approx_response_tokens: Math.ceil(Buffer.byteLength(content) / 4),
		leaf_read_bytes: leafReadBytes,
		requires_model_uat: passed === null,
	});
}
const p95 = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
};
const responseLatency = [...latency, ...contextLatency];
const answerable = results.filter(r => "kind" in r && r.kind === "answerable");
const scored = results.filter(r => r.passed !== null);
const report = {
	schema_version: 2,
	complete_response_hashes_verified: true,
	unpublished_preview: Boolean(preview),
	preview_source_commit: preview?.source_commit ?? null,
	source_provenance: preview ? "unpublished corpus;release pin fields are baseline only" : "immutable pinned release",
	post_analysis_regression: regression,
	source_provider_version: assets.pin.provider_version,
	source_commit: assets.pin.source_commit,
	index: assets.pin.index,
	suite_sha256: terraformHash(suiteBytes),
	frozen_source_provider_version: freeze.source_provider_version,
	platform: os.platform(),
	arch: os.arch(),
	materialization_ms: materializationMs,
	warm_p95_ms: p95(responseLatency),
	discovery_p95_ms: p95(latency),
	context_p95_ms: p95(contextLatency),
	route_p95_ms: p95(routeLatency),
	warm_measurement_count: responseLatency.length,
	discovery_measurement_count: latency.length,
	context_measurement_count: contextLatency.length,
	repetitions: 5,
	model_network_ms: null,
	model_uat_required: true,
	max_discovery_bytes: maxBytes,
	max_context_bytes: maxContextBytes,
	total_response_bytes: totalBytes,
	tool_calls: callCount,
	index_file_bytes: (await stat(assets.indexGzipPath)).size,
	answerable_accuracy: answerable.filter(r => r.passed).length / answerable.length,
	answerable_top5: answerable.filter(r => "top5" in r && r.top5).length / answerable.length,
	scored_accuracy: scored.filter(r => r.passed).length / scored.length,
	overall_accuracy: null,
	qualification_passed: false,
	results,
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
(await repo.database()).close();
console.log(JSON.stringify({ ...report, results: undefined }));
