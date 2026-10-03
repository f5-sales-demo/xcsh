// Development experiment only; does not modify bundled index.
import type { Database } from "bun:sqlite";
import { rankTerraformSections, terraformSectionTerms } from "./section-ranking";

export interface IndexedSection {
	provider_type: string;
	provider_name: string;
	schema_path: string;
	path: string;
	anchor: string;
	description: string;
}
export function populateAncestorSectionIndex(db: Database): void {
	const source = db;
	db.exec(
		"CREATE VIRTUAL TABLE section_search USING fts5(provider_type UNINDEXED,provider_name UNINDEXED,schema_path UNINDEXED,path UNINDEXED,anchor UNINDEXED,description UNINDEXED,leaf_terms,path_terms,description_terms,ancestor_terms,tokenize='unicode61')",
	);
	const rows = source
		.query(
			"SELECT provider_type,provider_name,schema_path,path,anchor,description FROM terraform_destinations ORDER BY provider_type,provider_name,schema_path",
		)
		.all() as IndexedSection[];
	const descriptions = new Map(
		rows
			.filter(r => r.anchor === "section")
			.map(r => [`${r.provider_type}|${r.provider_name}|${r.schema_path}`, r.description]),
	);
	const insert = db.prepare("INSERT INTO section_search VALUES(?,?,?,?,?,?,?,?,?,?)");
	db.transaction(() => {
		for (const row of rows) {
			const parts = row.schema_path.split(".");
			const ancestors = parts
				.slice(0, -1)
				.map(
					(_, i) =>
						descriptions.get(`${row.provider_type}|${row.provider_name}|${parts.slice(0, i + 1).join(".")}`) ??
						"",
				);
			insert.run(
				row.provider_type,
				row.provider_name,
				row.schema_path,
				row.path,
				row.anchor,
				row.description,
				terraformSectionTerms(parts.at(-1) ?? "").join(" "),
				terraformSectionTerms(row.schema_path).join(" "),
				terraformSectionTerms(row.description).join(" "),
				terraformSectionTerms(ancestors.join(" ")).join(" "),
			);
		}
	})();
	db.exec("INSERT INTO section_search(section_search) VALUES('optimize')");
}
export function searchAncestorSections(
	db: Database,
	query: string,
	providerName: string | undefined,
	providerType: string | undefined,
	limit = 5,
	scope?: { filters: Array<{ key: string; value: string }>; node?: string },
) {
	const terms = terraformSectionTerms(query);
	if (!terms.length) return [];
	const match = terms.map(term => `"${term}"`).join(" OR ");
	const clauses = ["section_search MATCH ?"];
	const args: Array<string | number> = [match];
	if (providerName) {
		clauses.push("provider_name=?");
		args.push(providerName);
	}
	if (providerType) {
		clauses.push("provider_type=?");
		args.push(providerType);
	}
	if (scope) {
		for (const filter of scope.filters) {
			clauses.push(
				"EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=section_search.path AND f.facet=? AND f.value=?)",
			);
			args.push(filter.key, filter.value);
		}
		if (scope.node) {
			clauses.push(
				"path IN (WITH RECURSIVE descendants(id,path) AS (SELECT id,path FROM terraform_documents WHERE id=? UNION SELECT d.id,d.path FROM terraform_documents d JOIN descendants n ON d.parent_id=n.id) SELECT path FROM descendants)",
			);
			args.push(scope.node);
		}
	}
	const candidates = db
		.query(
			`SELECT provider_type,provider_name,schema_path,path,anchor,description,ancestor_terms,bm25(section_search,0,0,0,0,0,0,8,5,2,1) bm25 FROM section_search WHERE ${clauses.join(" AND ")} ORDER BY bm25,provider_name,schema_path LIMIT 100`,
		)
		.all(...args) as Array<IndexedSection & { bm25: number; ancestor_terms: string }>;
	return rankTerraformSections(
		query,
		candidates.map(row => ({ ...row, description: `${row.description} ${row.ancestor_terms}` })),
	).slice(0, limit);
}
