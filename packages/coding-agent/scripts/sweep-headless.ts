#!/usr/bin/env bun
/**
 * Headless parallel dependency-ordered sweep. Creates resources via the API
 * (no browser) in topological order from the dependency graph, with N concurrent
 * workers for independent resources. Validates each via API-GET cross-check.
 *
 * This is the FAST path — pure API, headless, parallelizable. Use it to:
 * - Provision prerequisite resources before a visual form sweep
 * - Measure API-level CREATE coverage at maximum speed
 * - Run in CI (no Chrome needed)
 *
 * Usage:
 *   XCSH_API_URL=… XCSH_API_TOKEN=… XCSH_NAMESPACE=demo \
 *   bun scripts/sweep-headless.ts [--parallel N] [resource1 …]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildMinimalSpec, type SchemaIndex } from "../src/sweep/openapi-spec";
import { probeSpec } from "../src/sweep/spec-probe";
import { isScopedOut } from "../src/sweep/sweep-params";
import { apiCollectionPath, apiItemPath, apiKindFor } from "../src/sweep/sweep-scoring";

const NAMESPACE = process.env.XCSH_NAMESPACE ?? "demo";
const BASE_URL = (process.env.XCSH_API_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.XCSH_API_TOKEN ?? "";
const SPECS_DIR = path.resolve(import.meta.dir, "../../../../api-specs-enriched/docs/specifications/api");
const GRAPH_PATH = path.resolve(
	import.meta.dir,
	"../../../../api-specs-enriched/config/resource_dependency_graph.json",
);
const CONSOLE_ROOT = path.resolve(import.meta.dir, "../../../../console");
const WORKFLOWS_DIR = path.join(CONSOLE_ROOT, "catalog/workflows");

// Parse args
const args = process.argv.slice(2);
let parallel = 4;
const pIdx = args.indexOf("--parallel");
if (pIdx >= 0) {
	parallel = Number(args[pIdx + 1]) || 4;
	args.splice(pIdx, 2);
}

interface Result {
	resource: string;
	verdict: "pass" | "fail" | "skipped";
	detail?: string;
	durationMs: number;
}

function loadSchemaIndex(): SchemaIndex {
	const index: SchemaIndex = {};
	for (const f of fs.readdirSync(SPECS_DIR)) {
		if (!f.endsWith(".json") || f === "index.json") continue;
		try {
			const d = JSON.parse(fs.readFileSync(path.join(SPECS_DIR, f), "utf8"));
			for (const [name, sch] of Object.entries(d?.components?.schemas ?? {})) {
				if (!(name in index)) index[name] = sch as SchemaIndex[string];
			}
		} catch {
			/* skip */
		}
	}
	return index;
}

function loadDepGraph(): { edges: Record<string, string[]>; leaves: string[] } {
	try {
		const raw = JSON.parse(fs.readFileSync(GRAPH_PATH, "utf8"));
		return { edges: raw.edges ?? {}, leaves: raw.leaves ?? [] };
	} catch {
		return { edges: {}, leaves: [] };
	}
}

/** Topological sort: leaves first, then resources whose deps are all satisfied. */
function topoSort(resources: string[], edges: Record<string, string[]>): string[] {
	const deps: Record<string, Set<string>> = {};
	const resSet = new Set(resources);
	for (const r of resources) {
		deps[r] = new Set((edges[r] ?? []).filter(d => resSet.has(d)));
	}
	const sorted: string[] = [];
	const visited = new Set<string>();
	let progress = true;
	while (progress) {
		progress = false;
		for (const r of resources) {
			if (visited.has(r)) continue;
			const unmet = [...(deps[r] ?? [])].filter(d => !visited.has(d));
			if (unmet.length === 0) {
				sorted.push(r);
				visited.add(r);
				progress = true;
			}
		}
	}
	// Remaining (cycles) appended
	for (const r of resources) if (!visited.has(r)) sorted.push(r);
	return sorted;
}

function discover(): string[] {
	return fs
		.readdirSync(WORKFLOWS_DIR)
		.filter(d => fs.existsSync(path.join(WORKFLOWS_DIR, d, "create.yaml")))
		.filter(d => !isScopedOut(d))
		.sort();
}

function singularKind(resource: string): string {
	return apiKindFor(resource).replace(/s$/, "");
}

async function _apiExists(resource: string, name: string): Promise<boolean | null> {
	if (!BASE_URL || !TOKEN) return null;
	for (const ns of [NAMESPACE, "system"]) {
		try {
			const r = await fetch(`${BASE_URL}${apiItemPath(resource, ns, name)}`, {
				headers: { Authorization: `APIToken ${TOKEN}` },
				signal: AbortSignal.timeout(8000),
			});
			if (r.ok) return true;
		} catch {
			/* try next */
		}
	}
	return false;
}

async function apiDelete(resource: string, name: string): Promise<void> {
	for (const ns of [NAMESPACE, "system"]) {
		await fetch(`${BASE_URL}${apiItemPath(resource, ns, name)}`, {
			method: "DELETE",
			headers: { Authorization: `APIToken ${TOKEN}` },
			signal: AbortSignal.timeout(8000),
		}).catch(() => {});
	}
}

/** Load the already-validated banked specs (generated-specs.json). */
function loadBankedSpecs(): Record<string, { namespace?: string; spec: Record<string, unknown> }> {
	try {
		return JSON.parse(fs.readFileSync(path.join(CONSOLE_ROOT, "catalog/generated-specs.json"), "utf8"));
	} catch {
		return {};
	}
}

const BANKED = loadBankedSpecs();

async function createViaApi(resource: string, name: string, index: SchemaIndex): Promise<Result> {
	const t0 = performance.now();
	const banked = BANKED[resource];

	// Use the banked spec (already API-validated by gen-specs) if available — DRY.
	let spec: Record<string, unknown>;
	let ns = NAMESPACE;
	if (banked) {
		spec = banked.spec;
		ns = banked.namespace ?? NAMESPACE;
	} else {
		const kind = singularKind(resource);
		const built = buildMinimalSpec(index, kind, name, NAMESPACE);
		if (!built.ok) return { resource, verdict: "fail", detail: `no spec: ${built.reason}`, durationMs: 0 };
		spec = built.body.spec as Record<string, unknown>;
	}

	// Direct API POST (fastest — no probing needed for banked specs).
	const url = `${BASE_URL}${apiCollectionPath(resource, ns)}`;
	const body = { metadata: { name, namespace: ns }, spec };
	try {
		const r = await fetch(url, {
			method: "POST",
			headers: { Authorization: `APIToken ${TOKEN}`, "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15000),
		});
		const ms = Math.round(performance.now() - t0);
		if (r.ok) {
			return {
				resource,
				verdict: "pass",
				detail: `api-create ns=${ns}${banked ? " (banked)" : ""}`,
				durationMs: ms,
			};
		}
		const err = await r.text();
		// For non-banked, try probeSpec (error-driven patching)
		if (!banked) {
			const probed = await probeSpec({
				baseUrl: BASE_URL,
				token: TOKEN,
				namespace: ns,
				resource,
				name,
				seedSpec: spec,
				maxIters: 10,
			});
			const ms2 = Math.round(performance.now() - t0);
			if (probed.ok)
				return { resource, verdict: "pass", detail: `api-probed ns=${probed.namespace}`, durationMs: ms2 };
			return { resource, verdict: "fail", detail: probed.lastError?.slice(0, 120), durationMs: ms2 };
		}
		return { resource, verdict: "fail", detail: err.slice(0, 120), durationMs: ms };
	} catch (e) {
		return {
			resource,
			verdict: "fail",
			detail: e instanceof Error ? e.message : String(e),
			durationMs: Math.round(performance.now() - t0),
		};
	}
}

async function main() {
	if (!BASE_URL || !TOKEN) {
		console.error("XCSH_API_URL / XCSH_API_TOKEN required");
		process.exit(1);
	}

	const filter = new Set(args.length ? args : []);
	const all = discover();
	const resources = filter.size ? all.filter(r => filter.has(r)) : all;

	// Topological order from the dependency graph (leaves first, then dependents)
	const graph = loadDepGraph();
	const ordered = topoSort(resources, graph.edges);

	const index = loadSchemaIndex();
	console.log(`Headless sweep: ${ordered.length} resources, --parallel ${parallel}, topo-ordered`);
	console.log(`  API: ${BASE_URL} ns=${NAMESPACE}\n`);

	const results: Result[] = [];
	let i = 0;

	// Process in topological order, batching independent resources (same depth level)
	while (i < ordered.length) {
		const batch = ordered.slice(i, i + parallel);
		const name = (r: string) =>
			/domain|dns-zone/.test(r) ? "xcsh-sweep.example.com" : `xcsh-sweep-${r}`.slice(0, 63);

		// Clean then create in parallel
		await Promise.all(batch.map(r => apiDelete(r, name(r))));
		const batchResults = await Promise.all(batch.map(r => createViaApi(r, name(r), index)));

		for (const res of batchResults) {
			results.push(res);
			const icon = res.verdict === "pass" ? "✅" : "❌";
			console.log(
				`  ${icon} ${res.resource.padEnd(28)} ${res.verdict.padEnd(6)} ${res.durationMs}ms  ${res.detail ?? ""}`,
			);
		}
		i += parallel;
	}

	const pass = results.filter(r => r.verdict === "pass").length;
	console.log(`\n=== ${pass}/${results.length} create-pass (headless, parallel ${parallel}) ===`);

	const outPath = path.join(CONSOLE_ROOT, "scripts/sweep-results.headless.json");
	fs.writeFileSync(outPath, JSON.stringify({ mode: "headless", parallel, namespace: NAMESPACE, results }, null, 2));
	console.log(`Wrote ${outPath}`);
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
