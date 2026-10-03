import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { populatePropertyIndex, searchPropertyIndex, validatePropertyIndex } from "./property-index";
import { selectPropertyDestination } from "./property-selection";
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

test("reviewed destination aliases participate in scoped property retrieval", () => {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description); CREATE TABLE terraform_aliases(provider_type,provider_name,alias,path,anchor)",
	);
	db.exec(
		"INSERT INTO terraform_destinations VALUES('resources','fixture','tls.location','tls','schema-location','Encrypted secret location.'); INSERT INTO terraform_aliases VALUES('resources','fixture','existing certificate reference','tls','schema-location')",
	);
	populatePropertyIndex(db);
	expect(searchPropertyIndex(db, "existing certificate reference", { providerName: "fixture" })[0]?.schema_path).toBe(
		"tls.location",
	);
	const query = "Which property specifies existing certificate reference?";
	expect(selectPropertyDestination(query, searchPropertyIndex(db, query, { providerName: "fixture" })).kind).toBe(
		"leaf",
	);
	expect(searchPropertyIndex(db, "existing certificate reference", { providerType: "data-sources" })).toEqual([]);
	db.close();
});

test("shared reviewed aliases cannot choose an omitted provider role", () => {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description); CREATE TABLE terraform_aliases(provider_type,provider_name,alias,path,anchor)",
	);
	for (const role of ["resources", "data-sources"]) {
		db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)").run(
			role,
			"fixture",
			"tls.location",
			role,
			"schema-location",
			"Encrypted secret location.",
		);
		db.prepare("INSERT INTO terraform_aliases VALUES(?,?,?,?,?)").run(
			role,
			"fixture",
			"certificate location",
			role,
			"schema-location",
		);
	}
	populatePropertyIndex(db);
	const ranked = searchPropertyIndex(db, "which property specifies certificate location", { providerName: "fixture" });
	expect(ranked).toHaveLength(2);
	expect(selectPropertyDestination("which property specifies certificate location", ranked).kind).toBe("choices");
	db.close();
});

test("literal schema segments constrain retrieval before the candidate budget",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");const insert=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
 for(let i=0;i<30;i++)insert.run("resources","fixture",`decoy${i}.name`,`decoy${i}`,"schema-name","Requested name token ".repeat(30));
 insert.run("resources","fixture","oidc_auth.name","target","schema-target","Object name.");populatePropertyIndex(db);
 expect(searchPropertyIndex(db,"which field holds name under oidc_auth",{providerName:"fixture"},2).map(row=>row.path)).toEqual(["target"]);
 expect(searchPropertyIndex(db,"which field holds name under missing_schema",{providerName:"fixture"},2)).toEqual([]);db.close();
});

test("literal leaf names supplement broad passage candidates without escaping scope",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");const insert=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
 for(let i=0;i<30;i++)insert.run("resources","fixture",`branch${i}.other`,`decoy${i}`,"schema-other","name ".repeat(100));
 insert.run("resources","fixture","name","target","schema-name","Object identifier.");populatePropertyIndex(db);
 expect(searchPropertyIndex(db,"which field specifies name",{providerName:"fixture"},1).some(row=>row.path==="target")).toBe(true);
 expect(searchPropertyIndex(db,"which field specifies name",{providerName:"absent"},1)).toEqual([]);db.close();
});

test("documented property shape distinguishes object collections from item attributes", () => {
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description); CREATE TABLE terraform_documents(metadata)");
 db.exec("INSERT INTO terraform_destinations VALUES('resources','fixture','prefixes','parent','section','Prefix entries.'),('resources','fixture','prefixes.prefix','parent','schema-prefix','An address prefix.')");
 db.prepare("INSERT INTO terraform_documents VALUES(?)").run(JSON.stringify({provider_type:"resources",provider_name:"fixture",sections:[{schema_path:["prefixes"],type:"object",nesting:"list"},{schema_path:["prefixes","prefix"],type:"string",nesting:null}]}));
 populatePropertyIndex(db);
 const rows=searchPropertyIndex(db,"configure the list of prefixes in xcsh_fixture",{providerName:"fixture"});
 expect(rows.find(row=>row.schema_path==="prefixes")).toMatchObject({type:"object",nesting:"list"});
 expect(rows.find(row=>row.schema_path==="prefixes.prefix")).toMatchObject({type:"string",nesting:null});db.close();
});

test("conflicting property shape metadata cannot silently overwrite indexed evidence", () => {
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description);CREATE TABLE terraform_documents(metadata);INSERT INTO terraform_destinations VALUES('resources','fixture','rules','rules','section','Rules.')");
 const put=db.prepare("INSERT INTO terraform_documents VALUES(?)");for(const nesting of ["list","single"])put.run(JSON.stringify({provider_type:"resources",provider_name:"fixture",sections:[{schema_path:["rules"],type:"object",nesting}]}));
 expect(()=>populatePropertyIndex(db)).toThrow("Conflicting property shape");db.close();
});
