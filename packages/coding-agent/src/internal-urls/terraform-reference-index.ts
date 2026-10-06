import type { Database } from "bun:sqlite";
import type { PropertyCandidate } from "./terraform-property-ranking";
import { type TerraformReferenceIdentity, validateReferenceIdentity } from "./terraform-reference-evidence";
export const REFERENCE_INDEX_SQL = `CREATE TABLE property_reference_provenance(schema_version INTEGER NOT NULL);
 INSERT INTO property_reference_provenance VALUES(1);
 CREATE TABLE property_references(provider_type TEXT,provider_name TEXT,schema_path TEXT,scope_path TEXT,member TEXT,upstream_message TEXT,source TEXT,PRIMARY KEY(provider_type,provider_name,schema_path));
 CREATE INDEX property_reference_scope ON property_references(scope_path,member,provider_name,provider_type);`;
type IndexDatabase = { prepare(sql: string): { all(...values: any[]): unknown[]; run(...values: any[]): unknown } };
export function indexReferenceIdentity(db: IndexDatabase, row: PropertyCandidate, value: unknown) {
	const r = validateReferenceIdentity(value, row.schema_path.split("."));
	const existing = db
		.prepare(
			"SELECT scope_path,member,upstream_message,source FROM property_references WHERE provider_type=? AND provider_name=? AND schema_path=?",
		)
		.all(row.provider_type, row.provider_name, row.schema_path) as Array<{
		scope_path: string;
		member: string;
		upstream_message: string;
		source: string;
	}>;
	const values = [JSON.stringify(r.scope_path), r.member, r.upstream_message, r.source];
	if (existing.length) {
		const prior = existing[0]!;
		if (
			JSON.stringify([prior.scope_path, prior.member, prior.upstream_message, prior.source]) !==
			JSON.stringify(values)
		)
			throw new Error("Conflicting reference destination metadata");
	} else
		db.prepare("INSERT INTO property_references VALUES(?,?,?,?,?,?,?)").run(
			row.provider_type,
			row.provider_name,
			row.schema_path,
			...values,
		);
}
export function validateReferenceIndex(db: Database): boolean {
	const names = db
		.query("SELECT name FROM sqlite_master WHERE name IN ('property_references','property_reference_provenance')")
		.all() as { name: string }[];
	if (!names.length) return false;
	if (names.length !== 2) throw new Error("Incomplete reference index schema");
	const versions = db.query("SELECT schema_version FROM property_reference_provenance").all() as {
		schema_version: number;
	}[];
	if (versions.length !== 1 || versions[0]?.schema_version !== 1)
		throw new Error("Unsupported reference index version");
	if (!db.query("SELECT 1 FROM sqlite_master WHERE type='index' AND name='property_reference_scope'").get())
		throw new Error("Missing reference scope index");
	return true;
}
export function lookupReferenceMembers(
	db: Database,
	scope: {
		providerType?: string;
		providerName?: string;
		scopePath?: string[];
		member?: TerraformReferenceIdentity["member"];
		filters?: Array<{ key: string; value: string }>;
		node?: string;
	},
	limit = 500,
): PropertyCandidate[] {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error("Invalid reference candidate limit");
	if (scope.scopePath && (!scope.scopePath.length || !scope.scopePath.every(v => /^[a-z][a-z0-9_]*$/.test(v))))
		throw new Error("Invalid reference scope path");
	if (scope.member && !["name", "namespace", "tenant", "kind", "uid"].includes(scope.member))
		throw new Error("Invalid reference member");
	if (!validateReferenceIndex(db)) return [];
	const clauses: string[] = [],
		args: string[] = [];
	for (const [key, value] of [
		["provider_type", scope.providerType],
		["provider_name", scope.providerName],
		["scope_path", scope.scopePath ? JSON.stringify(scope.scopePath) : undefined],
		["member", scope.member],
	]) {
		if (value !== undefined) {
			clauses.push(`r.${key}=?`);
			args.push(value);
		}
	}
	for (const filter of scope.filters ?? []) {
		clauses.push("EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=p.path AND f.facet=? AND f.value=?)");
		args.push(filter.key, filter.value);
	}
	if (scope.node !== undefined) {
		if (!db.query("SELECT 1 FROM terraform_documents WHERE id=?").get(scope.node))
			throw new Error("Reference node not found");
		clauses.push(
			"p.path IN (WITH RECURSIVE descendants(id,path) AS (SELECT id,path FROM terraform_documents WHERE id=? UNION SELECT d.id,d.path FROM terraform_documents d JOIN descendants parent ON d.parent_id=parent.id) SELECT path FROM descendants)",
		);
		args.push(scope.node);
	}
	const rows = db
		.query(
			`SELECT p.provider_type,p.provider_name,p.schema_path,p.path,p.anchor,p.description,p.type,p.nesting,p.flags FROM property_references r JOIN property_terms p USING(provider_type,provider_name,schema_path) WHERE ${clauses.join(" AND ") || "1=1"} ORDER BY p.provider_type,p.provider_name,p.schema_path LIMIT ?`,
		)
		.all(...args, limit + 1) as Array<Omit<PropertyCandidate, "flags"> & { flags: string | null }>;
	if (rows.length > limit) throw new Error("Reference candidate pool exceeds limit");
	return rows.map(({ flags, ...row }) => ({
		...row,
		...(flags == null ? {} : { flags: JSON.parse(flags) as string[] }),
	}));
}

export function referenceScopeDestination(
	db: Database,
	providerType: string,
	providerName: string,
	schemaPath: string,
): { path: string; anchor: string } | undefined {
	if (!validateReferenceIndex(db)) return undefined;
	const evidence = db
		.query("SELECT scope_path FROM property_references WHERE provider_type=? AND provider_name=? AND schema_path=?")
		.get(providerType, providerName, schemaPath) as { scope_path: string } | null;
	if (!evidence) return undefined;
	const scope = JSON.parse(evidence.scope_path) as string[];
	const target = db
		.query(
			"SELECT path,anchor FROM terraform_destinations WHERE provider_type=? AND provider_name=? AND schema_path=?",
		)
		.get(providerType, providerName, scope.join(".")) as { path: string; anchor: string } | null;
	return target ?? undefined;
}
