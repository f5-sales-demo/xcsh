import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { populatePropertyIndex, validatePropertyIndex } from "../../src/internal-urls/terraform-property-index";
import { lookupReferenceMembers, referenceScopeDestination } from "../../src/internal-urls/terraform-reference-index";

const reference = {
	version: 1,
	scope_path: ["backend"],
	member: "namespace",
	upstream_message: "ves.io.schema.ObjectRefType",
	source: "receipt-pinned-schema-identity",
};
function fixture(extra?: Record<string, unknown>) {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description);CREATE TABLE terraform_documents(metadata)",
	);
	db.exec(
		"INSERT INTO terraform_destinations VALUES('resources','fixture','backend.namespace','p','schema-backend--namespace','Referenced namespace'); INSERT INTO terraform_destinations VALUES('resources','fixture','namespace','root','schema-namespace','Object namespace')",
	);
	const section = {
		schema_path: ["backend", "namespace"],
		flags: ["optional"],
		type: "string",
		reference_identity: reference,
	};
	db.prepare("INSERT INTO terraform_documents VALUES(?)").run(
		JSON.stringify({ provider_type: "resources", provider_name: "fixture", sections: [section] }),
	);
	if (extra)
		db.prepare("INSERT INTO terraform_documents VALUES(?)").run(
			JSON.stringify({ provider_type: "resources", provider_name: "fixture", sections: [{ ...section, ...extra }] }),
		);
	return db;
}
test("indexed reference ownership keeps root fields distinct and uses exact scope", () => {
	const db = fixture();
	populatePropertyIndex(db);
	expect(
		lookupReferenceMembers(db, {
			providerType: "resources",
			providerName: "fixture",
			scopePath: ["backend"],
			member: "namespace",
		}).map(r => r.schema_path),
	).toEqual(["backend.namespace"]);
	expect(
		lookupReferenceMembers(db, { providerType: "data-sources", providerName: "fixture", scopePath: ["backend"] }),
	).toEqual([]);
	expect(lookupReferenceMembers(db, { providerName: "fixture", scopePath: ["back"] })).toEqual([]);
	db.close();
});
test("identical reference projections deduplicate while conflicts reject", () => {
	const db = fixture({ reference_identity: Object.fromEntries(Object.entries(reference).reverse()) });
	populatePropertyIndex(db);
	expect(lookupReferenceMembers(db, { scopePath: ["backend"] })).toHaveLength(1);
	db.close();
	const bad = fixture({ reference_identity: { ...reference, upstream_message: "ves.io.schema.views.ObjectRefType" } });
	expect(() => populatePropertyIndex(bad)).toThrow("Conflicting reference");
	bad.close();
});
test("partial reference schemas and wrong versions reject; legacy absence returns empty", () => {
	const empty = new Database(":memory:");
	expect(lookupReferenceMembers(empty, {})).toEqual([]);
	empty.close();
	for (const mutate of [
		"DROP TABLE property_reference_provenance",
		"UPDATE property_reference_provenance SET schema_version=2",
		"DROP INDEX property_reference_scope",
	]) {
		const db = fixture();
		populatePropertyIndex(db);
		db.exec(mutate);
		expect(() => lookupReferenceMembers(db, {})).toThrow();
		db.close();
	}
});
test("reference lookup bounds reject overflow and malformed explicit scope", () => {
	const db = fixture();
	populatePropertyIndex(db);
	expect(() => lookupReferenceMembers(db, { scopePath: ["../backend"] })).toThrow();
	expect(() => lookupReferenceMembers(db, {}, 0)).toThrow();
	db.close();
});

test("reference schema validation participates in property provenance and scope indexes", () => {
	const db = fixture();
	populatePropertyIndex(db, { sourceCommit: "a", sourceIndexSha256: "b" });
	expect(() => validatePropertyIndex(db, { sourceCommit: "a", sourceIndexSha256: "b" })).not.toThrow();
	const plan = db
		.query("EXPLAIN QUERY PLAN SELECT * FROM property_references WHERE scope_path=? AND member=?")
		.all(JSON.stringify(["backend"]), "namespace") as { detail: string }[];
	expect(plan.some(r => r.detail.includes("property_reference_scope") && r.detail.includes("SEARCH"))).toBe(true);
	db.exec("UPDATE property_reference_provenance SET schema_version=2");
	expect(() => validatePropertyIndex(db, { sourceCommit: "a", sourceIndexSha256: "b" })).toThrow(
		"Unsupported reference",
	);
	db.close();
});
test("reference lookup rejects overflow without claiming unique ownership", () => {
	const db = fixture();
	populatePropertyIndex(db);
	db.exec(
		"INSERT INTO property_terms SELECT provider_type,'other',schema_path,path,anchor,description,leaf,context,description_terms,alias_terms,type,nesting,flags,documentation_terms FROM property_terms WHERE schema_path='backend.namespace'",
	);
	db.exec(
		"INSERT INTO property_references SELECT provider_type,'other',schema_path,scope_path,member,upstream_message,source FROM property_references",
	);
	expect(() => lookupReferenceMembers(db, {}, 1)).toThrow("exceeds limit");
	db.close();
});

test("reference scope respects AND facets and node descendants before limiting", () => {
	const db = fixture();
	db.exec("CREATE TABLE terraform_facets(path,facet,value)");
	db.exec(
		"ALTER TABLE terraform_documents ADD COLUMN id;ALTER TABLE terraform_documents ADD COLUMN parent_id;ALTER TABLE terraform_documents ADD COLUMN path",
	);
	db.exec(
		"UPDATE terraform_documents SET id='leaf',parent_id='parent',path='p';INSERT INTO terraform_documents(metadata,id,parent_id,path) VALUES('{}','parent',NULL,'parent')",
	);
	db.exec(
		"INSERT INTO terraform_facets VALUES('p','task','configuration');INSERT INTO terraform_facets VALUES('p','category','networking')",
	);
	populatePropertyIndex(db);
	const scope = {
		providerType: "resources",
		providerName: "fixture",
		scopePath: ["backend"],
		node: "parent",
		filters: [
			{ key: "task", value: "configuration" },
			{ key: "category", value: "networking" },
		],
	};
	expect(lookupReferenceMembers(db, scope)).toHaveLength(1);
	expect(
		lookupReferenceMembers(db, { ...scope, filters: [...scope.filters, { key: "task", value: "troubleshooting" }] }),
	).toEqual([]);
	expect(() => lookupReferenceMembers(db, { ...scope, node: "missing" })).toThrow();
	db.close();
});

test("verified reference members link to the exact parent destination only", () => {
	const db = fixture();
	db.exec(
		"INSERT INTO terraform_destinations VALUES('resources','fixture','backend','parent','section','Parent reference')",
	);
	populatePropertyIndex(db);
	expect(referenceScopeDestination(db, "resources", "fixture", "backend.namespace")).toEqual({
		path: "parent",
		anchor: "section",
	});
	expect(referenceScopeDestination(db, "resources", "fixture", "namespace")).toBeUndefined();
	expect(referenceScopeDestination(db, "data-sources", "fixture", "backend.namespace")).toBeUndefined();
	db.close();
});
