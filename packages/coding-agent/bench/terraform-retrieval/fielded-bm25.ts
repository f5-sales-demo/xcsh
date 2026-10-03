// Development-only fielded lexical experiment. No production import.
import type { Database } from "bun:sqlite";
import {
	type PropertyCandidate,
	propertyQueryTerms,
	propertyRequestedText,
	propertyTerms,
} from "../../src/internal-urls/terraform-property-ranking";
export function buildFieldedIndex(db: Database, rows: readonly PropertyCandidate[], sourceHash: string) {
	db.exec(
		`CREATE TABLE fielded_provenance(version INTEGER,source_sha256 TEXT); CREATE TABLE fielded_destinations(id INTEGER PRIMARY KEY,provider_type TEXT,provider_name TEXT,schema_path TEXT,path TEXT,anchor TEXT,description TEXT); CREATE VIRTUAL TABLE fielded_search USING fts5(identity,context,field);`,
	);
	db.prepare("INSERT INTO fielded_provenance VALUES(?,?)").run(1, sourceHash);
	const dest = db.prepare("INSERT INTO fielded_destinations VALUES(?,?,?,?,?,?,?)"),
		search = db.prepare("INSERT INTO fielded_search(rowid,identity,context,field) VALUES(?,?,?,?)");
	db.transaction(() => {
		for (const [i, r] of rows.entries()) {
			dest.run(i + 1, r.provider_type, r.provider_name, r.schema_path, r.path, r.anchor, r.description);
			search.run(
				i + 1,
				propertyTerms(r.provider_name).join(" "),
				propertyTerms(r.schema_path.split(".").slice(0, -1).join(" ")).join(" "),
				propertyTerms(`${r.schema_path.split(".").at(-1)} ${r.description}`).join(" "),
			);
		}
	})();
	db.prepare("INSERT INTO fielded_search(fielded_search) VALUES(?)").run("optimize");
}
export function searchFieldedIndex(
	db: Database,
	query: string,
	scope: { providerType?: string; providerName?: string },
	sourceHash: string,
	limit = 500,
) {
	const provenance = db.query("SELECT version,source_sha256 FROM fielded_provenance").get() as {
		version: number;
		source_sha256: string;
	} | null;
	if (provenance?.version !== 1 || provenance.source_sha256 !== sourceHash)
		throw new Error("Fielded index version/source mismatch");
	const terms = propertyQueryTerms(query);
	if (!terms.length) return [];
	const requested = propertyQueryTerms(propertyRequestedText(query) ?? query);
	const clauses = ["fielded_search MATCH ?"],
		args: string[] = [`(${terms.map(t => `"${t}"`).join(" OR ")})`];
	if (scope.providerType) {
		clauses.push("d.provider_type=?");
		args.push(scope.providerType);
	}
	if (scope.providerName) {
		clauses.push("d.provider_name=?");
		args.push(scope.providerName);
	}
	const rows = db
		.query(
			`SELECT d.*,bm25(fielded_search,2,1,4) ranking FROM fielded_search JOIN fielded_destinations d ON d.id=fielded_search.rowid WHERE ${clauses.join(" AND ")} ORDER BY ranking,d.path,d.anchor LIMIT ?`,
		)
		.all(...args, limit) as Array<PropertyCandidate & { ranking: number }>;
	return rows
		.map(r => {
			const field = new Set(propertyTerms(`${r.schema_path.split(".").at(-1)} ${r.description}`));
			const all = new Set(propertyTerms(`${r.provider_name} ${r.schema_path} ${r.description}`));
			const coverage = terms.filter(t => all.has(t)).length / terms.length;
			const target = requested.length ? requested.filter(t => field.has(t)).length / requested.length : 0;
			return { ...r, score: Number((-r.ranking * (1 + target)).toFixed(12)), coverage };
		})
		.sort(
			(a, b) =>
				b.score - a.score ||
				(a.path < b.path ? -1 : a.path > b.path ? 1 : a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
		);
}
