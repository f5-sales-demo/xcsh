/**
 * Build a resource dependency graph from the OpenAPI specs' ObjectRefType
 * annotations. Resources that reference other resources (via allOf →
 * schemaviewsObjectRefType or schemaNetworkSiteRefSelector) must be created
 * AFTER their dependencies. The graph enables topological ordering so the
 * sweep creates leaf resources first, then dependents that reference them.
 *
 * Single source of truth: the OpenAPI specs in api-specs-enriched.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface DepGraph {
	/** resource → set of resources it depends on (must exist before create). */
	edges: Record<string, string[]>;
	/** Topologically sorted: create in this order (leaves first). */
	sorted: string[];
	/** Resources with no dependencies (can be created independently). */
	leaves: string[];
	/** Resources that ARE depended on by others (create these first). */
	prerequisites: string[];
}

/**
 * Scan the OpenAPI spec schemas for ObjectRefType / RefSelector references
 * and build a dependency graph. Pure (reads from the schema index).
 */
/** Map a schema kind (underscored, no prefix/suffix) to a resource ID (kebab). */
function kindToResourceId(kind: string, knownResources: Set<string>): string | undefined {
	const kebab = kind.replace(/_/g, "-");
	if (knownResources.has(kebab)) return kebab;
	// Handle known API-kind overrides (healthcheck→health-check, http_loadbalancer→http-load-balancer)
	const OVERRIDES: Record<string, string> = {
		healthcheck: "health-check",
		"http-loadbalancer": "http-load-balancer",
		"tcp-loadbalancer": "tcp-load-balancer",
		"udp-loadbalancer": "udp-loadbalancer",
		"cdn-loadbalancer": "cdn-loadbalancer",
		route: "route-object",
	};
	return OVERRIDES[kebab] && knownResources.has(OVERRIDES[kebab]) ? OVERRIDES[kebab] : undefined;
}

export function buildDepGraph(schemaIndex: Record<string, Record<string, unknown>>, resourceIds: string[]): DepGraph {
	const edges: Record<string, Set<string>> = {};
	const knownResources = new Set(resourceIds);

	for (const [name, sch] of Object.entries(schemaIndex)) {
		if (!name.includes("CreateSpecType")) continue;
		const rawKind = name.replace(/^(views|schema)/, "").replace(/CreateSpecType$/, "");
		const src = kindToResourceId(rawKind, knownResources);
		if (!src) continue;

		const props = (sch as Record<string, unknown>).properties as Record<string, Record<string, unknown>> | undefined;
		if (!props) continue;

		for (const [fieldName, fieldSchema] of Object.entries(props)) {
			const allOf = (fieldSchema.allOf ?? []) as Array<Record<string, unknown>>;
			for (const entry of allOf) {
				const ref = (entry.$ref ?? "") as string;
				if (ref.includes("ObjectRefType") || ref.includes("RefSelector") || ref.includes("RefType")) {
					const target = kindToResourceId(fieldName, knownResources);
					if (target && target !== src) {
						if (!edges[src]) edges[src] = new Set();
						edges[src].add(target);
					}
				}
			}
		}
	}

	// Convert sets to arrays
	const edgeArrays: Record<string, string[]> = {};
	for (const [k, v] of Object.entries(edges)) edgeArrays[k] = [...v];

	// Topological sort (Kahn's algorithm)
	const inDegree: Record<string, number> = {};
	for (const r of resourceIds) inDegree[r] = 0;
	for (const deps of Object.values(edgeArrays)) {
		for (const d of deps) inDegree[d] = (inDegree[d] ?? 0) + 0; // ensure exists
	}
	for (const [src, deps] of Object.entries(edgeArrays)) {
		for (const d of deps) {
			if (d in inDegree) inDegree[src] = (inDegree[src] ?? 0) + 1;
		}
	}

	const queue = resourceIds.filter(r => (inDegree[r] ?? 0) === 0);
	const sorted: string[] = [];
	const visited = new Set<string>();

	// BFS topological sort — dependencies come before dependents
	const q = [...queue];
	while (q.length) {
		const r = q.shift()!;
		if (visited.has(r)) continue;
		visited.add(r);
		sorted.push(r);
		// Find resources that depend on r and decrement their in-degree
		for (const [src, deps] of Object.entries(edgeArrays)) {
			if (deps.includes(r) && !visited.has(src)) {
				inDegree[src] = (inDegree[src] ?? 1) - 1;
				if (inDegree[src] <= 0) q.push(src);
			}
		}
	}
	// Add any remaining (cycles or disconnected) at the end
	for (const r of resourceIds) {
		if (!visited.has(r)) sorted.push(r);
	}

	const leaves = resourceIds.filter(r => !edgeArrays[r]?.length);
	const depTargets = new Set(Object.values(edgeArrays).flat());
	const prerequisites = resourceIds.filter(r => depTargets.has(r));

	return { edges: edgeArrays, sorted, leaves, prerequisites };
}

/**
 * Load the schema index from the OpenAPI spec files (same as gen-specs.ts).
 */
export function loadSchemaIndex(specsDir: string): Record<string, Record<string, unknown>> {
	const index: Record<string, Record<string, unknown>> = {};
	for (const f of fs.readdirSync(specsDir)) {
		if (!f.endsWith(".json") || f === "index.json") continue;
		try {
			const d = JSON.parse(fs.readFileSync(path.join(specsDir, f), "utf8"));
			for (const [name, sch] of Object.entries(d?.components?.schemas ?? {})) {
				if (!(name in index)) index[name] = sch as Record<string, unknown>;
			}
		} catch {
			/* skip unparseable */
		}
	}
	return index;
}
