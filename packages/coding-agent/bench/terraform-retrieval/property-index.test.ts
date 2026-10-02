import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { populatePropertyIndex, searchPropertyIndex, validatePropertyIndex } from "./property-index";
import { preparePropertyScope, rankPropertyScope } from "./contrastive-ranking";
test("indexed prepared property terms preserve provider-scoped ranking", () => {
	const db = new Database(":memory:");
	db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");
	const rows = [
		{
			provider_type: "resources",
			provider_name: "fixture",
			schema_path: "tls.port",
			path: "documentation/resources/fixture/tls/index.md",
			anchor: "schema-tls--port",
			description: "Listening TCP port.",
		},
		{
			provider_type: "resources",
			provider_name: "fixture",
			schema_path: "tls.timeout",
			path: "documentation/resources/fixture/tls/index.md",
			anchor: "schema-tls--timeout",
			description: "Connection timeout.",
		},
	];
	const insert = db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
	for (const r of rows) insert.run(r.provider_type, r.provider_name, r.schema_path, r.path, r.anchor, r.description);
	populatePropertyIndex(db);
	const expected = rankPropertyScope("TLS listening port", preparePropertyScope(rows));
	expect(
		searchPropertyIndex(db, "TLS listening port", { providerType: "resources", providerName: "fixture" }),
	).toEqual(expected);
	expect(
		searchPropertyIndex(db, "TLS listening port", { providerType: "data-sources", providerName: "fixture" }),
	).toEqual([]);
	expect(
		searchPropertyIndex(db, "unseen invented option", { providerType: "resources", providerName: "fixture" }),
	).toEqual([]);
	db.close();
});
test("property index generations have deterministic contents and scope counts", () => {
	const create = () => {
		const db = new Database(":memory:");
		db.exec(
			"CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description); INSERT INTO terraform_destinations VALUES('resources','fixture','port','documentation/resources/fixture/index.md','schema-port','Listening port')",
		);
		populatePropertyIndex(db);
		return db;
	};
	const a = create(),
		b = create();
	expect(a.query("SELECT * FROM property_scope_terms ORDER BY provider_type,provider_name,term").all()).toEqual(
		b.query("SELECT * FROM property_scope_terms ORDER BY provider_type,provider_name,term").all(),
	);
	expect(a.query("SELECT * FROM property_scopes").all()).toEqual([
		{ provider_type: "resources", provider_name: "fixture", destination_count: 1 },
	]);
	a.close();
	b.close();
});

test("facets combine with AND and node descendants constrain indexed candidates", () => {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description); CREATE TABLE terraform_documents(id,parent_id,path); CREATE TABLE terraform_facets(path,facet,value);",
	);
	const insert = db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
	const pathA = "documentation/resources/fixture/a/index.md",
		pathB = "documentation/resources/fixture/b/index.md";
	for (const [path, name] of [
		[pathA, "a"],
		[pathB, "b"],
	])
		insert.run("resources", "fixture", name + ".port", path, "schema-" + name + "--port", "Listening port");
	db.prepare("INSERT INTO terraform_documents VALUES(?,?,?)").run("root", null, "documentation/index.md");
	db.prepare("INSERT INTO terraform_documents VALUES(?,?,?)").run("branch-a", "root", pathA);
	db.prepare("INSERT INTO terraform_documents VALUES(?,?,?)").run("branch-b", null, pathB);
	const facet = db.prepare("INSERT INTO terraform_facets VALUES(?,?,?)");
	facet.run(pathA, "category", "networking");
	facet.run(pathA, "task", "configuration");
	facet.run(pathB, "category", "networking");
	facet.run(pathB, "task", "troubleshooting");
	populatePropertyIndex(db);
	const scope = {
		providerType: "resources",
		providerName: "fixture",
		filters: [
			{ key: "category", value: "networking" },
			{ key: "task", value: "configuration" },
		],
		node: "root",
	};
	expect(searchPropertyIndex(db, "listening port", scope).map(row => row.path)).toEqual([pathA]);
	expect(
		searchPropertyIndex(db, "listening port", { ...scope, filters: [{ key: "task", value: "troubleshooting" }] }),
	).toEqual([]);
	db.close();
});

test("prepared index rejects mismatched source provenance and format", () => {
	const db = new Database(":memory:");
	db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");
	populatePropertyIndex(db, { sourceCommit: "a".repeat(40), sourceIndexSha256: "b".repeat(64) });
	expect(() =>
		validatePropertyIndex(db, { sourceCommit: "a".repeat(40), sourceIndexSha256: "b".repeat(64) }),
	).not.toThrow();
	expect(() => validatePropertyIndex(db, { sourceCommit: "c".repeat(40), sourceIndexSha256: "b".repeat(64) })).toThrow(
		"source mismatch",
	);
	db.exec("UPDATE property_index_provenance SET schema_version=99");
	expect(() => validatePropertyIndex(db, { sourceCommit: "a".repeat(40), sourceIndexSha256: "b".repeat(64) })).toThrow(
		"version",
	);
	db.close();
});
