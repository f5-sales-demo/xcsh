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

test("example enum constants do not constrain schema-path candidates",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description);INSERT INTO terraform_destinations VALUES('resources','fixture','loadbalancer_algorithm','algorithm','schema-algorithm','Load balancing algorithm')");populatePropertyIndex(db);
 expect(searchPropertyIndex(db,"Which field sets loadbalancer_algorithm (such as ROUND_ROBIN or LEAST_ACTIVE)?",{providerName:"fixture"})[0]?.schema_path).toBe("loadbalancer_algorithm");db.close();
});

test("explicit top-level scope constrains indexed candidates before limiting",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description);INSERT INTO terraform_destinations VALUES('resources','fixture','name','root','schema-name','Name.'),('resources','fixture','nested.name','nested','schema-nested-name','Name name name.')");populatePropertyIndex(db);
 expect(searchPropertyIndex(db,"Which top-level attribute specifies name?",{providerName:"fixture"},1).map(row=>row.schema_path)).toEqual(["name"]);db.close();
});

test("explicit type filters apply before the indexed candidate limit",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description);CREATE TABLE terraform_documents(metadata)");const put=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");for(const [field,type,description] of [["port","number","Traffic port traffic"],["redirect","bool","Redirect traffic"]]){put.run("resources","fixture",field,field,"schema-"+field,description);db.prepare("INSERT INTO terraform_documents VALUES(?)").run(JSON.stringify({provider_type:"resources",provider_name:"fixture",sections:[{schema_path:[field],type}]}));}populatePropertyIndex(db);
 expect(searchPropertyIndex(db,"Which boolean flag enables traffic redirect?",{providerName:"fixture"},1).map(row=>row.type)).toEqual(["bool"]);db.close();
});

test("verified lifecycle operation scope limits candidate retrieval",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");const put=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");for(const operation of ["create","delete","read"])put.run("resources","fixture","timeouts."+operation,operation,"schema-"+operation,"Duration string for operation.");populatePropertyIndex(db);
 expect(searchPropertyIndex(db,"maximum duration for destruction",{providerName:"fixture",schemaPaths:["timeouts.delete"]},1).map(row=>row.schema_path)).toEqual(["timeouts.delete"]);db.close();
});

test("documented flags survive retrieval without accepting a user requiredness assumption",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description);CREATE TABLE terraform_documents(metadata)");const put=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");for(const [field,flags] of ([["listen_port",["required"]],["nested.port",["optional"]]] as Array<[string,string[]]>)){put.run("resources","fixture",field,field,"schema-"+field,"Listening port.");db.prepare("INSERT INTO terraform_documents VALUES(?)").run(JSON.stringify({provider_type:"resources",provider_name:"fixture",sections:[{schema_path:field.split("."),type:"number",flags}]}));}populatePropertyIndex(db);
 expect(searchPropertyIndex(db,"Which required attribute specifies listening port?",{providerName:"fixture"}).find(row=>row.schema_path==="nested.port")?.flags).toEqual(["optional"]);
 expect(searchPropertyIndex(db,"Which required attribute specifies listening port?",{providerName:"fixture"})[0]?.flags).toEqual(["required"]);db.close();
});

test("conflicting documented field flags reject instead of silently replacing evidence",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description);CREATE TABLE terraform_documents(metadata);INSERT INTO terraform_destinations VALUES('resources','fixture','name','name','schema-name','Name.')");for(const flags of [["required"],["optional"]])db.prepare("INSERT INTO terraform_documents VALUES(?)").run(JSON.stringify({provider_type:"resources",provider_name:"fixture",sections:[{schema_path:["name"],type:"string",flags}]}));
 expect(()=>populatePropertyIndex(db)).toThrow("Conflicting property flag");db.close();
});

test("canonical field prose supplements support evidence without replacing metadata",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description);CREATE TABLE terraform_sections(path,anchor,context_markdown);INSERT INTO terraform_destinations VALUES('ephemeral-resources','fixture','data','page','schema-data','HTTP binary body.')");
 db.prepare("INSERT INTO terraform_sections VALUES(?,?,?)").run("page","schema-data","<a id=\"schema-data\"></a>\n\n### data property\n\nType: `string`. Computed.\n\nRendered manifest payload data.\n\nUpstream description:\n\nHTTP binary body.\n\nValidation:\n\nDo not index validator details.");populatePropertyIndex(db);
 const rows=searchPropertyIndex(db,"Which attribute returns rendered manifest payload data?",{providerName:"fixture"});
 expect(rows[0]?.description).toBe("HTTP binary body.");expect(rows[0]?.documentation_terms).toContain("manifest");expect(rows[0]?.documentation_terms).not.toContain("validator");expect(selectPropertyDestination("Which attribute returns rendered manifest payload data?",rows).kind).toBe("leaf");db.close();
});

test("unscoped architecture alternatives retain workload paths without relaxing other providers", () => {
 const db=new Database(":memory:");
 db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");
 const put=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
 for (const provider of ["workload","fixture"]) for(const architecture of ["service","stateful_service"])
 put.run("resources",provider,`${architecture}.port`,`${provider}/${architecture}`,"schema-port","Listener port.");
 populatePropertyIndex(db);
 const query="stateless or stateful_service workload port";
 const rows=searchPropertyIndex(db,query,{});
 expect(rows.filter(row=>row.provider_name==="workload").map(row=>row.schema_path).sort()).toEqual(["service.port","stateful_service.port"]);
 expect(rows.filter(row=>row.provider_name==="fixture").map(row=>row.schema_path)).toEqual(["stateful_service.port"]);
 expect(searchPropertyIndex(db,query,{providerType:"data-sources"})).toEqual([]);
 db.close();
});

test("explicit dotted schema paths bind contiguous segments rather than unordered words",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");const put=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
 for(const schema of ["alpha.beta.port","beta.alpha.port","alpha.betax.port"])put.run("resources","fixture",schema,schema,"schema-port","Listening port.");populatePropertyIndex(db);
 expect(searchPropertyIndex(db,"Which field sets port under alpha.beta?",{providerName:"fixture"}).map(r=>r.schema_path)).toEqual(["alpha.beta.port"]);
 expect(searchPropertyIndex(db,"Which field sets port under alpha.missing?",{providerName:"fixture"})).toEqual([]);
 expect(searchPropertyIndex(db,"Which field sets port under alpha.beta?",{providerType:"data-sources"})).toEqual([]);db.close();
});

test("explicit path parser does not truncate malformed tokens or lose scope to earlier wording",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");const put=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
 for(const schema of ["alpha.beta.port","gamma.delta.port"])put.run("resources","fixture",schema,schema,"schema-port","Listening port.");populatePropertyIndex(db);
 for(const query of ["under alpha.beta.1missing", "under alpha.beta-missing", "No rewrite is needed. Which field sets port under alpha.missing?", "port or timeout under alpha.missing"])
 expect(searchPropertyIndex(db,query,{providerName:"fixture"})).toEqual([]);
 for(const query of ["port under alpha.beta or under gamma.delta", "port under alpha.beta and under gamma.delta", "port under alpha.beta, or gamma.delta"])
 expect(searchPropertyIndex(db,query,{providerName:"fixture"})).toHaveLength(2);
 db.close();
});

test("suppressed dotted path intent cannot leak into underscore identifier filters",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");const put=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
 for(const schema of ["alpha_one.beta_two.port","gamma_three.delta_four.port"])put.run("resources","fixture",schema,schema,"schema-port","Listening port.");populatePropertyIndex(db);
 expect(searchPropertyIndex(db,"port under alpha_one.beta_two or under gamma_three.delta_four",{providerName:"fixture"})).toHaveLength(2);
 expect(searchPropertyIndex(db,"port not under alpha_one.beta_two",{providerName:"fixture"})).toHaveLength(2);db.close();
});

test("bare alternative paths and quoted malformed endings remain literal",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");const put=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
 for(const schema of ["alpha_one.beta_two.port","gamma_three.delta_four.port","alpha.beta.port"])put.run("resources","fixture",schema,schema,"schema-port","Listening port.");populatePropertyIndex(db);
 const rows=searchPropertyIndex(db,"port under alpha_one.beta_two or gamma_three.delta_four",{providerName:"fixture"});expect(rows).toHaveLength(3);
 expect(searchPropertyIndex(db,"Which field sets port under `alpha.beta.`?",{providerName:"fixture"})).toEqual([]);db.close();
});

test("conjunction-only and repeated path mentions are choices; malformed dotted punctuation stays literal",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");const put=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
 for(const schema of ["alpha.beta.port","gamma.delta.port"])put.run("resources","fixture",schema,schema,"schema-port","Listening port.");populatePropertyIndex(db);
 for(const query of ["port or alpha.beta","port under alpha.beta or alpha.beta","port under alpha.beta and under alpha.beta"])
 expect(searchPropertyIndex(db,query,{providerName:"fixture"})).toHaveLength(2);
 expect(searchPropertyIndex(db,"port under alpha.beta., with TLS enabled",{providerName:"fixture"})).toEqual([]);db.close();
});

test("sentence punctuation and ignored mention spans preserve independent identifiers",()=>{
 const db=new Database(":memory:");db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");const put=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
 for(const schema of ["alpha.beta.port","alpha_one.beta_two.port"])put.run("resources","fixture",schema,schema,"schema-port","Listening port.");populatePropertyIndex(db);
 expect(searchPropertyIndex(db,"Port under alpha.beta. Use TLS.",{providerName:"fixture"}).map(r=>r.schema_path)).toEqual(["alpha.beta.port"]);
 expect(searchPropertyIndex(db,"set field alpha_one.beta_two_extra, not under alpha_one.beta_two",{providerName:"fixture"})).toEqual([]);db.close();
});


test("bare dotted lookup constrains indexed candidates and cannot invent child fields", () => {
 const db=new Database(":memory:");
 db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description); INSERT INTO terraform_destinations VALUES('resources','fixture','calibration.offset','fixture','schema-calibration--offset','Calibration offset');");
 populatePropertyIndex(db);
 expect(searchPropertyIndex(db,"Locate calibration.missing.",{providerName:"fixture"})).toEqual([]);
 expect(searchPropertyIndex(db,"Locate calibration.offset.",{providerName:"fixture"})[0]?.schema_path).toBe("calibration.offset");
 db.close();
});


test("outside a named underscore branch excludes it before indexed ranking", () => {
 const db=new Database(":memory:");
 db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description); INSERT INTO terraform_destinations VALUES('resources','fixture','policy.action','direct','schema-policy--action','Action for requests'), ('resources','fixture','detection_settings.policy.action','nested','schema-detection--action','Action for requests');");
 populatePropertyIndex(db);
 expect(searchPropertyIndex(db,"Find the action outside detection_settings.",{providerName:"fixture"}).map(r=>r.schema_path)).toEqual(["policy.action"]);
 expect(searchPropertyIndex(db,"Find the action inside detection_settings",{providerName:"fixture"}).map(r=>r.schema_path)).toEqual(["detection_settings.policy.action"]);
 db.close();
});

test("indexed candidate limits report hidden matches before selection",()=>{
 const db=new Database(":memory:");
 db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");
 const put=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
 for(let i=0;i<8;i++)put.run("resources","fixture","branch"+i+".port","p"+i,"schema-port","Listening port.");
 populatePropertyIndex(db);
 const limited:{truncated?:boolean}={};
 expect(searchPropertyIndex(db,"Listening port",{providerName:"fixture"},2,limited).length).toBeLessThanOrEqual(4);
 expect(limited.truncated).toBe(true);
 const complete:{truncated?:boolean}={};
 searchPropertyIndex(db,"Listening port",{providerName:"fixture"},20,complete);
 expect(complete.truncated).toBe(false);
 db.close();
});
test("invalid candidate limits fail before diagnostics or SQL",()=>{
 const db=new Database(":memory:");
 for(const limit of [-2,0,1.5,NaN,Infinity]){
 const status={truncated:true};
 expect(()=>searchPropertyIndex(db,"port",{},limit,status)).toThrow("Invalid property candidate limit");
 expect(status.truncated).toBe(true);
 }
 db.close();
});
