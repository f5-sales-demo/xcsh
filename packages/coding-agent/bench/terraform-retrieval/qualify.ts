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
import { evaluateClarificationTree, type FrozenClarificationTree } from "./clarification-tree";
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
const treeFile = path.join(path.dirname(suiteFile), "clarification-trees.json");
let trees: Record<string, FrozenClarificationTree> = {};
if (await Bun.file(treeFile).exists()) {
	if (freeze.schema_version !== 2) throw new Error("Clarification trees require an independently reviewed freeze");
	const treeBytes = await readFile(treeFile);
	if (terraformHash(treeBytes) !== freeze.files?.["clarification-trees.json"])
		throw new Error("Frozen clarification tree digest mismatch");
	const protocolFile = path.join(root, "clarification-qualification-protocol.md");
	if (terraformHash(await readFile(protocolFile)) !== freeze.clarification_protocol_sha256)
		throw new Error("Frozen clarification scoring protocol mismatch");
	trees = JSON.parse(treeBytes.toString());
	const heldout = JSON.parse(await readFile(path.join(path.dirname(suiteFile), "heldout.json"), "utf8")) as Case[];
	if (Object.keys(trees).some(id => !heldout.some(c => c.id === id && c.kind === "ambiguous")))
		throw new Error("Frozen tree requires an ambiguous suite case");
}

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

	if (trees[c.id]) {
		const tree = trees[c.id]!;
		if (new URL(tree.root.request).searchParams.get("search") !== c.prompt)
			throw new Error("Frozen clarification prompt mismatch");

		const db = await repo.database();
		const targets: string[] = [];
		const auditTree = (node: FrozenClarificationTree["root"], parentNode?: string) => {
			const request = new URL(node.request);
			const scopeNode = request.searchParams.get("node");
			if (scopeNode && !db.query("SELECT 1 FROM terraform_documents WHERE id=?").get(scopeNode))
				throw new Error("Frozen clarification node missing from source");
			if (
				parentNode &&
				scopeNode !== parentNode &&
				!db
					.query(
						"WITH RECURSIVE descendants(id) AS (SELECT id FROM terraform_documents WHERE parent_id=? UNION SELECT d.id FROM terraform_documents d JOIN descendants p ON d.parent_id=p.id) SELECT 1 FROM descendants WHERE id=?",
					)
					.get(parentNode, scopeNode)
			)
				throw new Error("Frozen clarification node is not a strict descendant");
			if (node.children) {
				for (const child of node.children) auditTree(child, scopeNode ?? parentNode);
				return;
			}
			const target = new URL(node.expected!);
			target.search = "";
			targets.push(target.href);
			const documentPath = target.pathname.slice(1);
			const anchor = decodeURIComponent(target.hash.slice(1));
			const record = db.query("SELECT id FROM terraform_documents WHERE path=?").get(documentPath) as {
				id: string;
			} | null;
			if (
				!record ||
				!anchor ||
				!db.query("SELECT 1 FROM terraform_sections WHERE path=? AND anchor=?").get(documentPath, anchor)
			)
				throw new Error("Frozen clarification terminal anchor missing from source");
			if (
				scopeNode &&
				!db
					.query(
						"WITH RECURSIVE descendants(id) AS (SELECT id FROM terraform_documents WHERE id=? UNION SELECT d.id FROM terraform_documents d JOIN descendants p ON d.parent_id=p.id) SELECT 1 FROM descendants WHERE id=?",
					)
					.get(scopeNode, record.id)
			)
				throw new Error("Frozen terminal escapes reviewed node");
			for (const key of ["provider_type", "provider_name", "role", "category", "capability", "task"]) {
				const value = request.searchParams.get(key);
				if (
					value &&
					!db
						.query("SELECT 1 FROM terraform_facets WHERE path=? AND facet=? AND value=?")
						.get(documentPath, key, value)
				)
					throw new Error("Frozen terminal escapes caller filters");
			}
		};
		auditTree(tree.root);
		const expected = c.expected.map(uri => normalize(uri));
		if (targets.length !== expected.length || targets.some(uri => !expected.includes(uri)))
			throw new Error("Frozen clarification leaves do not partition expected destinations");
		const evaluated = await evaluateClarificationTree(read, tree, 5);
		const first = evaluated.responses[0]!;
		for (const row of evaluated.responses) {
			latency.push(...row.discoveryTimes);
			contextLatency.push(...row.contextTimes);
			routeLatency.push(...row.routeTimes);
			maxBytes = Math.max(maxBytes, row.maxDiscoveryBytes);
			maxContextBytes = Math.max(maxContextBytes, row.maxContextBytes);
		}
		callCount += evaluated.tool_calls;
		totalBytes += evaluated.total_response_bytes;
		results.push({
			id: c.id,
			kind: c.kind,
			passed: evaluated.passed,
			top5: false,
			rank: null,
			matched_expected: 0,
			selected: first.discovery.includes("Selected leaf;"),
			selection_correct: evaluated.passed,
			destinations: [],
			times_ms: first.discoveryTimes,
			route_times_ms: first.routeTimes,
			response_sha256: first.responseHash,
			response_bytes: Buffer.byteLength(first.discovery),
			approx_response_tokens: Math.ceil(Buffer.byteLength(first.discovery) / 4),
			leaf_read_bytes: null,
			requires_model_uat: false,
			clarification_tree: {
				passed: evaluated.passed,
				findings: evaluated.findings,
				requests: evaluated.responses.map(row => ({
					request: row.request,
					response_sha256: row.responseHash,
					times_ms: row.routeTimes,
				})),
			},
		});
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
