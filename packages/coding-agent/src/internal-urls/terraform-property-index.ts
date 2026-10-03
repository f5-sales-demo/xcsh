// Prepared property terms are generated with the immutable documentation index.
import type { Database } from "bun:sqlite";
import {
	type PropertyCandidate,
	preparePropertyScope,
	propertyQueryTerms,
	propertyRequestedText,
	propertyRequestedType,
	propertyRequestsBlock,
	propertyRequestsRootField,
	propertySchemaIdentifiers,
	rankPropertyScope,
} from "./terraform-property-ranking";
export interface PropertyIndexSource {
	sourceCommit: string;
	sourceIndexSha256: string;
}
export function validatePropertyIndex(db: Database, source: PropertyIndexSource) {
	const row = db
		.query("SELECT schema_version,source_commit,source_index_sha256 FROM property_index_provenance")
		.get() as { schema_version: number; source_commit: string; source_index_sha256: string } | null;
	if (row?.schema_version !== 6) throw new Error("Unsupported property index version");
	if (row.source_commit !== source.sourceCommit || row.source_index_sha256 !== source.sourceIndexSha256)
		throw new Error("Property index source mismatch");
}
export function populatePropertyIndex(
	db: {
		exec(sql: string): unknown;
		prepare(sql: string): { all(...values: any[]): unknown[]; run(...values: any[]): unknown };
		transaction(fn: () => void): () => void;
	},
	source?: PropertyIndexSource,
) {
	db.exec(`CREATE TABLE property_index_provenance(schema_version INTEGER,source_commit TEXT,source_index_sha256 TEXT);
 CREATE TABLE property_scopes(provider_type TEXT,provider_name TEXT,destination_count INTEGER,PRIMARY KEY(provider_type,provider_name));
 CREATE TABLE property_scope_terms(provider_type TEXT,provider_name TEXT,term TEXT,weight REAL,PRIMARY KEY(provider_type,provider_name,term));
 CREATE TABLE property_terms(provider_type TEXT,provider_name TEXT,schema_path TEXT,path TEXT,anchor TEXT,description TEXT,leaf TEXT,context TEXT,description_terms TEXT,alias_terms TEXT,type TEXT,nesting TEXT,flags TEXT,PRIMARY KEY(provider_type,provider_name,schema_path));
 CREATE INDEX property_leaf_lookup ON property_terms(leaf,provider_name,provider_type);
 CREATE VIRTUAL TABLE property_search USING fts5(terms,provider_type UNINDEXED,provider_name UNINDEXED,schema_path UNINDEXED);`);
	db.prepare("INSERT INTO property_index_provenance VALUES(?,?,?)").run(
		6,
		source?.sourceCommit ?? "",
		source?.sourceIndexSha256 ?? "",
	);
	const rows = db
		.prepare(
			"SELECT provider_type,provider_name,schema_path,path,anchor,description FROM terraform_destinations ORDER BY provider_type,provider_name,schema_path",
		)
		.all() as PropertyCandidate[];

	if (db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").all("terraform_aliases").length) {
		const aliases = db
			.prepare(
				"SELECT provider_type,provider_name,path,anchor,alias FROM terraform_aliases ORDER BY provider_type,provider_name,path,anchor,alias",
			)
			.all() as Array<{ provider_type: string; provider_name: string; path: string; anchor: string; alias: string }>;
		const destinations = new Map(
			rows.map(row => [`${row.provider_type}:${row.provider_name}:${row.path}#${row.anchor}`, row]),
		);
		for (const alias of aliases) {
			const target = destinations.get(`${alias.provider_type}:${alias.provider_name}:${alias.path}#${alias.anchor}`);
			if (target) {
				target.aliases ??= [];
				target.aliases.push(alias.alias);
			}
		}
	}
	if (db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name=?").all("terraform_documents", "metadata").length) {
		const destinations = new Map(
			rows.map(row => [`${row.provider_type}:${row.provider_name}:${row.schema_path}`, row]),
		);
		const documents = db.prepare("SELECT metadata FROM terraform_documents ORDER BY metadata").all() as {
			metadata: string;
		}[];
		for (const document of documents) {
			const metadata = JSON.parse(document.metadata) as {
				provider_type: string;
				provider_name: string;
				sections?: { schema_path: string[]; type?: string; nesting?: string | null; flags?: string[] }[];
			};
			for (const section of metadata.sections ?? []) {
				const row = destinations.get(
					`${metadata.provider_type}:${metadata.provider_name}:${section.schema_path.join(".")}`,
				);
				if (row) {
					if (
						row.type !== undefined &&
						(row.type !== (section.type ?? null) || row.nesting !== (section.nesting ?? null))
					)
						throw new Error("Conflicting property shape metadata");
					row.type = section.type ?? null;
					row.nesting = section.nesting ?? null;
					if (
						row.flags !== undefined &&
						JSON.stringify(row.flags.toSorted()) !== JSON.stringify((section.flags ?? []).toSorted())
					)
						throw new Error("Conflicting property flag metadata");
					row.flags = section.flags;
				}
			}
		}
	}
	const groups = new Map<string, PropertyCandidate[]>();
	for (const row of rows) {
		const key = `${row.provider_type}|${row.provider_name}`;
		const group = groups.get(key) ?? [];
		group.push(row);
		groups.set(key, group);
	}
	const insertScope = db.prepare("INSERT INTO property_scopes VALUES(?,?,?)"),
		insertWeight = db.prepare("INSERT INTO property_scope_terms VALUES(?,?,?,?)"),
		insertTerm = db.prepare("INSERT INTO property_terms VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"),
		insertSearch = db.prepare("INSERT INTO property_search VALUES(?,?,?,?)");
	db.transaction(() => {
		for (const group of groups.values()) {
			const scope = preparePropertyScope(group);
			const identity = group[0]!;
			insertScope.run(identity.provider_type, identity.provider_name, group.length);
			for (const [term, weight] of scope.weights)
				insertWeight.run(identity.provider_type, identity.provider_name, term, weight);
			for (const row of scope.rows) {
				insertTerm.run(
					row.provider_type,
					row.provider_name,
					row.schema_path,
					row.path,
					row.anchor,
					row.description,
					JSON.stringify(row.leaf),
					JSON.stringify(row.context),
					JSON.stringify(row.descriptionTerms),
					JSON.stringify(row.aliasTerms),
					row.type ?? null,
					row.nesting ?? null,
					row.flags === undefined ? null : JSON.stringify(row.flags),
				);
				insertSearch.run(
					[...row.leaf, ...row.context, ...row.descriptionTerms, ...row.aliasTerms].join(" "),
					row.provider_type,
					row.provider_name,
					row.schema_path,
				);
			}
		}
	})();
	db.exec("INSERT INTO property_search(property_search) VALUES('optimize')");
}
export function searchPropertyIndex(
	db: Database,
	query: string,
	scope: {
		providerType?: string;
		providerName?: string;
		filters?: Array<{ key: string; value: string }>;
		node?: string;
		schemaPaths?: string[];
	},
	limit = 500,
) {
	const terms = propertyQueryTerms(query);
	if (!terms.length) return [];
	const clauses = ["property_search MATCH ?"];
	const args: string[] = [terms.map(term => `"${term}"`).join(" OR ")];
	if (scope.schemaPaths?.length) {
		clauses.push(`schema_path IN (${scope.schemaPaths.map(() => "?").join(",")})`);
		args.push(...scope.schemaPaths);
	}
	if (scope.providerType) {
		clauses.push("provider_type=?");
		args.push(scope.providerType);
	}
	if (scope.providerName) {
		clauses.push("provider_name=?");
		args.push(scope.providerName);
	}

	if (propertyRequestsRootField(query)) clauses.push("instr(schema_path, char(46))=0");
	const requestedType = propertyRequestedType(query);
	if (requestedType) {
		clauses.push(
			"EXISTS(SELECT 1 FROM property_terms typed WHERE typed.provider_type=property_search.provider_type AND typed.provider_name=property_search.provider_name AND typed.schema_path=property_search.schema_path AND (typed.type IS NULL OR typed.type=?))",
		);
		args.push(requestedType);
	}
	const identifiers = propertySchemaIdentifiers(query).filter(
		term => !db.query("SELECT 1 FROM property_scopes WHERE provider_name=?").get(term),
	);
	for (const identifier of identifiers) {
		clauses.push("instr('.' || schema_path || '.',?)>0");
		args.push(`.${identifier}.`);
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
	const requested = propertyQueryTerms(propertyRequestedText(query) ?? query);
	const leafKeys = [
		...new Set(
			requested.flatMap((term, index) => [
				JSON.stringify([term]),
				...(index + 1 < requested.length ? [JSON.stringify(requested.slice(index, index + 2))] : []),
				...(index + 2 < requested.length ? [JSON.stringify(requested.slice(index, index + 3))] : []),
			]),
		),
	];
	const exact = propertyRequestsBlock(query)
		? []
		: (db
				.query(
					`SELECT provider_type,provider_name,schema_path FROM property_terms property_search WHERE ${clauses.slice(1).join(" AND ") || "1=1"} AND leaf IN (${leafKeys.map(() => "?").join(",")}) ORDER BY provider_type,provider_name,schema_path LIMIT ?`,
				)
				.all(...args.slice(1), ...leafKeys, limit) as typeof candidates);
	const union = [
		...new Map(
			[...exact, ...candidates].map(row => [`${row.provider_type}:${row.provider_name}:${row.schema_path}`, row]),
		).values(),
	];
	const groups = new Map<string, string[]>();
	for (const row of union) {
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
			PropertyCandidate & { leaf: string; context: string; description_terms: string; alias_terms: string }
		>;
		const weights = db
			.query(
				`SELECT term,weight FROM property_scope_terms WHERE provider_type=? AND provider_name=? AND term IN (${terms.map(() => "?").join(",")}) ORDER BY term`,
			)
			.all(type!, name!, ...terms) as { term: string; weight: number }[];
		const rows = prepared.map(({ leaf, context, description_terms, alias_terms, flags, ...row }) => ({
			...(flags == null ? {} : { flags: JSON.parse(flags as unknown as string) as string[] }),
			...row,
			...(row.type === null ? { type: undefined } : {}),
			...(row.nesting === null && row.type === null ? { nesting: undefined } : {}),
			leaf: JSON.parse(leaf) as string[],
			context: JSON.parse(context) as string[],
			descriptionTerms: JSON.parse(description_terms) as string[],
			aliasTerms: JSON.parse(alias_terms) as string[],
		}));
		ranked.push(...rankPropertyScope(query, { rows, weights: new Map(weights.map(row => [row.term, row.weight])) }));
	}
	return ranked.sort(
		(a, b) =>
			b.score - a.score ||
			(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
			(a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
	);
}
