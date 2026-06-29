#!/usr/bin/env bun
/**
 * Generate minimal valid create specs for resources by walking the enriched
 * OpenAPI schemas (openapi-spec.ts), then VALIDATE each against the live API by
 * POSTing to the correct API-group path and deleting on success. Emits a
 * resource→spec map + a pass/fail report. This is the hybrid spec source for the
 * JSON-tab create path: OpenAPI structure, API as source of truth.
 *
 * Usage:
 *   XCSH_API_URL=… XCSH_API_TOKEN=… XCSH_NAMESPACE=demo \
 *   bun scripts/gen-specs.ts [resource1 …]      # omit args = all (non-cloud)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildMinimalSpec, type SchemaIndex } from "../src/sweep/openapi-spec";
import { probeSpec } from "../src/sweep/spec-probe";
import { isScopedOut } from "../src/sweep/sweep-params";
import { apiKindFor } from "../src/sweep/sweep-scoring";

const SPECS_DIR =
	process.env.XCSH_OPENAPI_DIR ??
	path.resolve(import.meta.dir, "../../../../api-specs-enriched/docs/specifications/api");
const WORKFLOWS_DIR = path.resolve(import.meta.dir, "../../../../console/catalog/workflows");
const NAMESPACE = process.env.XCSH_NAMESPACE ?? "demo";
const BASE_URL = (process.env.XCSH_API_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.XCSH_API_TOKEN ?? "";
const OUT = process.env.SPECS_OUT ?? path.join(WORKFLOWS_DIR, "../generated-specs.json");

function loadIndex(): SchemaIndex {
	const index: SchemaIndex = {};
	for (const f of fs.readdirSync(SPECS_DIR)) {
		if (!f.endsWith(".json") || f === "index.json") continue;
		try {
			const d = JSON.parse(fs.readFileSync(path.join(SPECS_DIR, f), "utf8"));
			for (const [name, sch] of Object.entries(d?.components?.schemas ?? {})) {
				if (!(name in index)) index[name] = sch as SchemaIndex[string];
			}
		} catch {
			/* skip unparseable spec file */
		}
	}
	return index;
}

/** Singular API kind for the OpenAPI schema name, e.g. "healthchecks" → "healthcheck". */
function singularKind(resource: string): string {
	return apiKindFor(resource).replace(/s$/, "");
}

function discover(filter: string[]): string[] {
	return fs
		.readdirSync(WORKFLOWS_DIR)
		.filter(d => fs.existsSync(path.join(WORKFLOWS_DIR, d, "create.yaml")))
		.filter(d => !isScopedOut(d))
		.filter(d => filter.length === 0 || filter.includes(d))
		.sort();
}

async function main() {
	const index = loadIndex();
	console.log(`Loaded ${Object.keys(index).length} schemas from ${SPECS_DIR}`);
	const resources = discover(process.argv.slice(2));
	const specs: Record<string, unknown> = {};
	let pass = 0;
	for (const resource of resources) {
		const name = /domain|dns-zone/.test(resource) ? "xcsh-gen.example.com" : `xcsh-gen-${resource}`.slice(0, 63);
		const built = buildMinimalSpec(index, singularKind(resource), name, NAMESPACE);
		if (!built.ok) {
			console.log(`  ❌ ${resource.padEnd(26)} ${built.reason}`);
			continue;
		}
		// Walker-seed → prober-patch: start the error-driven prober from the walker's spec.
		const v = await probeSpec({
			baseUrl: BASE_URL,
			token: TOKEN,
			namespace: NAMESPACE,
			resource,
			name,
			seedSpec: built.body.spec as Record<string, unknown>,
		});
		if (v.ok) {
			pass++;
			specs[resource] = { namespace: v.namespace, metadata: { name, namespace: v.namespace }, spec: v.spec };
			console.log(`  ✅ ${resource.padEnd(26)} [${v.namespace}/${v.iters}i] ${JSON.stringify(v.spec).slice(0, 55)}`);
		} else {
			console.log(`  ❌ ${resource.padEnd(26)} ${v.lastError}`);
		}
	}
	fs.writeFileSync(OUT, JSON.stringify(specs, null, 2));
	console.log(`\nWalker+API validated: ${pass}/${resources.length} → wrote ${OUT}`);
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
