// Development-only provider discovery; never a benchmark answer map.
import type { Database } from "bun:sqlite";
import { propertyQueryTerms } from "../../src/internal-urls/terraform-property-ranking";
export interface ProviderRecord {
	provider_type: string;
	provider_name: string;
	path: string;
	summary: string;
	aliases: string[];
	facets: Array<{ key: string; value: string }>;
}
export interface ProviderDiscoverySource {
	sourceCommit: string;
	sourceIndexSha256: string;
}
export function validateProviderDiscovery(db: Database, source: ProviderDiscoverySource) {
	const row = db.query("SELECT * FROM provider_discovery_provenance").get() as {
		schema_version: number;
		source_commit: string;
		source_index_sha256: string;
	} | null;
	if (row?.schema_version !== 1) throw new Error("Unsupported provider discovery version");
	if (row.source_commit !== source.sourceCommit || row.source_index_sha256 !== source.sourceIndexSha256)
		throw new Error("Provider discovery source mismatch");
}
export function buildProviderDiscovery(db: Database, records: ProviderRecord[], source?: ProviderDiscoverySource) {
	db.exec(
		"CREATE TABLE provider_discovery_provenance(schema_version INTEGER,source_commit TEXT,source_index_sha256 TEXT)",
	);
	db.prepare("INSERT INTO provider_discovery_provenance VALUES(?,?,?)").run(
		1,
		source?.sourceCommit ?? "",
		source?.sourceIndexSha256 ?? "",
	);
	db.exec(
		`CREATE VIRTUAL TABLE provider_search USING fts5(terms,provider_type UNINDEXED,provider_name UNINDEXED,path UNINDEXED); CREATE TABLE provider_facets(path TEXT,facet TEXT,value TEXT,PRIMARY KEY(path,facet,value)); CREATE INDEX provider_facet_lookup ON provider_facets(facet,value,path);`,
	);
	const identities = new Map<string, ProviderRecord>();
	for (const record of records) {
		const key = `${record.provider_type}:${record.provider_name}`;
		const previous = identities.get(key);
		if (previous) {
			previous.summary += ` ${record.summary}`;
			previous.aliases = [...new Set([...previous.aliases, ...record.aliases])];
			previous.facets.push(...record.facets);
		} else identities.set(key, { ...record, aliases: [...record.aliases], facets: [...record.facets] });
	}
	records = [...identities.values()];
	const insert = db.prepare("INSERT INTO provider_search VALUES(?,?,?,?)"),
		facet = db.prepare("INSERT OR IGNORE INTO provider_facets VALUES(?,?,?)");
	db.transaction(() => {
		for (const r of records) {
			insert.run(
				propertyQueryTerms(`${r.provider_name.replaceAll("_", " ")} ${r.summary} ${r.aliases.join(" ")}`).join(" "),
				r.provider_type,
				r.provider_name,
				r.path,
			);
			for (const f of r.facets) facet.run(r.path, f.key, f.value);
		}
	})();
	db.prepare("INSERT INTO provider_search(provider_search) VALUES (?)").run("optimize");
}
export function searchProviderDiscovery(
	db: Database,
	query: string,
	scope: { providerType?: string; filters?: Array<{ key: string; value: string }> },
	limit = 5,
) {
	const terms = propertyQueryTerms(query);
	if (!terms.length) return [];
	const clauses = ["provider_search MATCH ?"],
		args: string[] = [terms.map(t => `"${t}"`).join(" OR ")];
	if (scope.providerType) {
		clauses.push("provider_type=?");
		args.push(scope.providerType);
	}
	for (const f of scope.filters ?? []) {
		clauses.push(
			"EXISTS(SELECT 1 FROM provider_facets f WHERE f.path=provider_search.path AND f.facet=? AND f.value=?)",
		);
		args.push(f.key, f.value);
	}
	const rows = db
		.query(
			`SELECT provider_type,provider_name,path,terms,bm25(provider_search) ranking FROM provider_search WHERE ${clauses.join(" AND ")} ORDER BY ranking,provider_type,provider_name LIMIT ?`,
		)
		.all(...args, limit) as Array<{
		provider_type: string;
		provider_name: string;
		path: string;
		terms: string;
		ranking: number;
	}>;
	return rows.map(r => ({
		provider_type: r.provider_type,
		provider_name: r.provider_name,
		path: r.path,
		score: Number((-r.ranking).toFixed(12)),
		coverage: terms.filter(t => r.terms.split(" ").includes(t)).length / terms.length,
	}));
}
