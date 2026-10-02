import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { populatePropertyIndex, searchPropertyIndex } from "./property-index";
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
