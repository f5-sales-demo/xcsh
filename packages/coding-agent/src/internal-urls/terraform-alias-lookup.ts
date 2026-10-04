import type { Database } from "bun:sqlite";

/** Exact reviewed terminology inventory; this never selects a destination. */
export function lookupTerraformAlias(
	db: Database,
	alias: string,
	scope: {
		providerType: string;
		providerName: string;
		filters?: Array<{ key: string; value: string }>;
		node?: string;
	},
) {
	const clauses = ["a.provider_type=?", "a.provider_name=?", "a.alias=?"];
	const args = [scope.providerType, scope.providerName, alias];
	for (const filter of scope.filters ?? []) {
		clauses.push("EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=a.path AND f.facet=? AND f.value=?)");
		args.push(filter.key, filter.value);
	}
	if (scope.node) {
		if (!db.query("SELECT 1 FROM terraform_documents WHERE id=?").get(scope.node))
			throw new Error("Terraform alias node not found");
		clauses.push(
			"a.path IN (WITH RECURSIVE descendants(id,path) AS (SELECT id,path FROM terraform_documents WHERE id=? UNION SELECT d.id,d.path FROM terraform_documents d JOIN descendants p ON d.parent_id=p.id) SELECT path FROM descendants)",
		);
		args.push(scope.node);
	}
	const rows = db
		.query(
			`SELECT a.path,a.anchor,d.id FROM terraform_aliases a JOIN terraform_documents d ON d.path=a.path JOIN terraform_sections s ON s.path=a.path AND s.anchor=a.anchor WHERE ${clauses.join(" AND ")} ORDER BY a.path COLLATE BINARY,a.anchor COLLATE BINARY LIMIT 1001`,
		)
		.all(...args) as Array<{ path: string; anchor: string; id: string }>;
	if (rows.length > 1000) throw new Error("Terraform alias inventory exceeds candidate limit; narrow scope");
	return rows;
}
