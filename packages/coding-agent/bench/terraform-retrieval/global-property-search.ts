import type { Database } from "bun:sqlite";
import {
	type PropertyCandidate,
	propertyQueryTerms,
	rankPropertyScope,
} from "../../src/internal-urls/terraform-property-ranking";
import { readGlobalWeights } from "./global-property-weights";
export function searchGloballyWeightedProperties(
	db: Database,
	global: Database,
	sourceHash: string,
	query: string,
	scope: {
		providerType?: string;
		providerName?: string;
		filters?: Array<{ key: string; value: string }>;
		node?: string;
	},
	limit = 500,
) {
	const terms = propertyQueryTerms(query);
	if (!terms.length) return [];
	const clauses = ["property_search MATCH ?"];
	const args: string[] = [terms.map(term => `"${term}"`).join(" OR ")];
	if (scope.providerType) {
		clauses.push("provider_type=?");
		args.push(scope.providerType);
	}
	if (scope.providerName) {
		clauses.push("provider_name=?");
		args.push(scope.providerName);
	}

	for (const filter of scope.filters ?? []) {
		clauses.push(
			"EXISTS(SELECT 1 FROM property_terms pt JOIN terraform_facets f ON f.path=pt.path WHERE pt.provider_type=property_search.provider_type AND pt.provider_name=property_search.provider_name AND pt.schema_path=property_search.schema_path AND f.facet=? AND f.value=?)",
		);
		args.push(filter.key, filter.value);
	}
	if (scope.node) {
		if (!db.query("SELECT 1 FROM terraform_documents WHERE id=?").get(scope.node))
			throw new Error("Property node not found");
		clauses.push(
			"EXISTS(SELECT 1 FROM property_terms pt WHERE pt.provider_type=property_search.provider_type AND pt.provider_name=property_search.provider_name AND pt.schema_path=property_search.schema_path AND pt.path IN (WITH RECURSIVE descendants(id,path) AS (SELECT id,path FROM terraform_documents WHERE id=? UNION SELECT d.id,d.path FROM terraform_documents d JOIN descendants parent ON d.parent_id=parent.id) SELECT path FROM descendants))",
		);
		args.push(scope.node);
	}
	const candidates = db
		.query(
			`SELECT provider_type,provider_name,schema_path FROM property_search WHERE ${clauses.join(" AND ")} ORDER BY bm25(property_search),provider_type,provider_name,schema_path LIMIT ?`,
		)
		.all(...args, limit) as { provider_type: string; provider_name: string; schema_path: string }[];
	const groups = new Map<string, string[]>();
	for (const row of candidates) {
		const key = `${row.provider_type}|${row.provider_name}`;
		const group = groups.get(key) ?? [];
		group.push(row.schema_path);
		groups.set(key, group);
	}
	const ranked = [];
	for (const [key, paths] of groups) {
		const [type, name] = key.split("|");
		const prepared = db
			.query(
				`SELECT * FROM property_terms WHERE provider_type=? AND provider_name=? AND schema_path IN (${paths.map(() => "?").join(",")}) ORDER BY schema_path`,
			)
			.all(type!, name!, ...paths) as Array<
			PropertyCandidate & { leaf: string; context: string; description_terms: string }
		>;
		const weights = readGlobalWeights(global, terms, sourceHash);
		const rows = prepared.map(({ leaf, context, description_terms, ...row }) => ({
			...row,
			leaf: JSON.parse(leaf) as string[],
			context: JSON.parse(context) as string[],
			descriptionTerms: JSON.parse(description_terms) as string[],
		}));
		ranked.push(...rankPropertyScope(query, { rows, weights }));
	}
	return ranked.sort(
		(a, b) =>
			b.score - a.score ||
			(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
			(a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
	);
}
