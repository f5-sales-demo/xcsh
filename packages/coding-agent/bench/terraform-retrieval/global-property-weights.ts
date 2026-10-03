// Development-only corpus-wide weighting; no runtime corpus preload.
import type { Database } from "bun:sqlite";
export function populateGlobalWeights(db: Database, destinations: Iterable<readonly string[]>, sourceHash: string) {
	db.exec(
		"CREATE TABLE global_weight_provenance(version INTEGER,source_sha256 TEXT,destinations INTEGER); CREATE TABLE global_property_weights(term TEXT PRIMARY KEY,frequency INTEGER,weight REAL)",
	);
	const frequencies = new Map<string, number>();
	let count = 0;
	for (const terms of destinations) {
		count++;
		for (const term of new Set(terms)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
	}
	db.prepare("INSERT INTO global_weight_provenance VALUES(?,?,?)").run(1, sourceHash, count);
	const insert = db.prepare("INSERT INTO global_property_weights VALUES(?,?,?)");
	db.transaction(() => {
		for (const [term, frequency] of [...frequencies].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			insert.run(term, frequency, Math.log(2 + count / (1 + frequency)));
	})();
}
export function readGlobalWeights(db: Database, terms: readonly string[], sourceHash: string): Map<string, number> {
	const provenance = db.query("SELECT version,source_sha256 FROM global_weight_provenance").get() as {
		version: number;
		source_sha256: string;
	} | null;
	if (provenance?.version !== 1) throw new Error("Unsupported global weight version");
	if (provenance.source_sha256 !== sourceHash) throw new Error("Global weight source mismatch");
	if (!terms.length) return new Map();
	const rows = db
		.query(
			`SELECT term,weight FROM global_property_weights WHERE term IN (${terms.map(() => "?").join(",")}) ORDER BY term`,
		)
		.all(...terms) as Array<{ term: string; weight: number }>;
	return new Map(rows.map(r => [r.term, r.weight]));
}
