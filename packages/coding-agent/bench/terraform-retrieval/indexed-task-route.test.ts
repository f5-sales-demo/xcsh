import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { resolveIndexedTask } from "./indexed-task-route";

function fixture() {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE terraform_documents(id,parent_id,path,provider_type,provider_name,role,summary); CREATE TABLE terraform_sections(path,anchor,ordinal,heading,context_markdown); CREATE TABLE terraform_facets(path,facet,value)",
	);
	const doc = db.prepare("INSERT INTO terraform_documents VALUES(?,?,?,?,?,?,?)");
	const section = db.prepare("INSERT INTO terraform_sections VALUES(?,?,?,?,?)");
	for (const [name, role, anchor] of [
		["setup", "overview", "argument-reference"],
		["setup", "overview", "authentication-options"],
		["setup", "overview", "option-1-api-token-authentication"],
		["setup", "overview", "option-2-p12-certificate-authentication"],
		["setup", "overview", "option-3-pem-certificate-authentication"],
		["fixture", "import", "import"],
		["fixture", "fundamentals", "minimal-configuration"],
	]) {
		const path = `documentation/${name}/${role}/index.md`;
		if (!db.query("SELECT 1 FROM terraform_documents WHERE path=?").get(path))
			doc.run(path, null, path, name === "setup" ? "provider" : "resources", name, role, `${name} ${role}`);
		section.run(path, anchor, 0, anchor, `Complete ${anchor} section.`);
	}
	return db;
}
test("provider argument reference and explicit auth method route to exact maintained anchors", () => {
	const db = fixture();
	expect(
		resolveIndexedTask(db, "provider argument reference listing configuration options", {})?.destinations[0]?.anchor,
	).toBe("argument-reference");
	expect(resolveIndexedTask(db, "provider API token authentication", {})?.destinations[0]?.anchor).toBe(
		"option-1-api-token-authentication",
	);
	expect(resolveIndexedTask(db, "set up provider authentication", {})?.kind).toBe("choices");
	db.close();
});
test("lifecycle routing honors provider and role while property questions remain property retrieval", () => {
	const db = fixture();
	expect(
		resolveIndexedTask(db, "import an existing fixture resource", {
			providerName: "fixture",
			providerType: "resources",
		})?.destinations[0]?.anchor,
	).toBe("import");
	expect(
		resolveIndexedTask(db, "which property holds the fixture token", {
			providerName: "fixture",
			providerType: "resources",
		}),
	).toBeUndefined();
	expect(
		resolveIndexedTask(db, "import fixture", { providerName: "fixture", providerType: "data-sources" })?.destinations,
	).toEqual([]);
	db.close();
});
test("task constraints combine facets and descendants without escaping caller scope", () => {
	const db = fixture();
	db.prepare("INSERT INTO terraform_facets VALUES(?,?,?)").run(
		"documentation/fixture/import/index.md",
		"task",
		"import",
	);
	expect(
		resolveIndexedTask(db, "import fixture", {
			providerName: "fixture",
			filters: [{ key: "task", value: "authentication" }],
		})?.destinations,
	).toEqual([]);
	expect(() => resolveIndexedTask(db, "import fixture", { providerName: "fixture", node: "missing" })).toThrow("node");
	expect(resolveIndexedTask(db, "provider API token authentication invented_flag", {})?.destinations).toEqual([]);
	db.close();
});

test("task identifier matching is literal and cannot accept a longer documented name", () => {
	const db = fixture();
	db.exec(
		"UPDATE terraform_sections SET context_markdown='Configure api_token_extra' WHERE anchor='option-1-api-token-authentication'",
	);
	expect(resolveIndexedTask(db, "provider API token authentication api_token", {})?.kind).toBe("none");
	db.exec(
		"UPDATE terraform_sections SET context_markdown='Configure api_token with the provider.' WHERE anchor='option-1-api-token-authentication'",
	);
	expect(resolveIndexedTask(db, "provider API token authentication api_token", {})?.kind).toBe("leaf");
	db.close();
});

test("setup routing honors an explicit incompatible provider name", () => {
	const db = fixture();
	expect(resolveIndexedTask(db, "provider API token authentication", { providerName: "fixture" })?.kind).toBe("none");
	expect(resolveIndexedTask(db, "provider API token authentication", { providerName: "setup" })?.kind).toBe("leaf");
	db.close();
});

test("inferred setup vocabulary does not become an explicit caller constraint", () => {
	const db = fixture();
	expect(
		resolveIndexedTask(db, "xcsh provider block argument reference", { providerName: "xcsh", inferredIdentity: true })
			?.kind,
	).toBe("leaf");
	expect(
		resolveIndexedTask(db, "set up provider authentication", {
			providerName: "authentication",
			providerType: "resources",
			inferredIdentity: true,
		})?.kind,
	).toBe("choices");
	expect(
		resolveIndexedTask(db, "xcsh_fixture provider block argument reference", {
			providerName: "fixture",
			inferredIdentity: true,
		})?.kind,
	).toBe("none");
	expect(resolveIndexedTask(db, "provider argument reference", { providerType: "resources" })?.kind).toBe("none");
	db.close();
});

test("authentication clarification offers exact compatible method destinations", () => {
	const db = fixture();
	expect(
		resolveIndexedTask(db, "provider certificate-based mutual TLS authentication", {})?.destinations.map(
			row => row.anchor,
		),
	).toEqual(["option-2-p12-certificate-authentication", "option-3-pem-certificate-authentication"]);
	expect(resolveIndexedTask(db, "set up provider authentication", {})?.destinations).toHaveLength(3);
	db.close();
});

test("inferred action plurality requires explicit cardinality or provider identifier", () => {
	const db = fixture();
	for (const name of ["access_active_session_terminate", "access_active_sessions_terminate"]) {
		const path = `documentation/actions/${name}/index.md`;
		db.prepare("INSERT INTO terraform_documents VALUES(?,?,?,?,?,?,?)").run(
			name,
			null,
			path,
			"actions",
			name,
			"fundamentals",
			"Terminate access sessions",
		);
		db.prepare("INSERT INTO terraform_sections VALUES(?,?,?,?,?)").run(
			path,
			"minimal-configuration",
			0,
			"Minimal configuration",
			"Complete documented action.",
		);
	}
	const scope = { providerName: "access_active_sessions_terminate", providerType: "actions", inferredIdentity: true };
	expect(resolveIndexedTask(db, "Which action revokes active user access sessions?", scope)?.kind).toBe("choices");
	expect(resolveIndexedTask(db, "Which action revokes multiple active user access sessions?", scope)?.kind).toBe(
		"leaf",
	);
	expect(resolveIndexedTask(db, "How do I invoke xcsh_access_active_sessions_terminate action?", scope)?.kind).toBe(
		"leaf",
	);
	db.close();
});

test("adjusting a lifecycle timeout requires an operation while guidance stays complete", () => {
	const db = fixture();
	db.exec("CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description)");
	db.prepare("INSERT INTO terraform_documents VALUES(?,?,?,?,?,?,?)").run(
		"timeout-guide",
		null,
		"documentation/fixture/lifecycle/timeouts/index.md",
		"resources",
		"fixture",
		"timeouts",
		"Timeout guidance",
	);
	db.prepare("INSERT INTO terraform_sections VALUES(?,?,?,?,?)").run(
		"documentation/fixture/lifecycle/timeouts/index.md",
		"timeouts",
		0,
		"timeouts",
		"Complete timeout guidance",
	);
	for (const op of ["create", "read", "update", "delete"])
		db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)").run(
			"resources",
			"fixture",
			`timeouts.${op}`,
			"documentation/fixture/properties/timeouts/index.md",
			`schema-timeouts--${op}`,
			`${op} timeout`,
		);
	const result = resolveIndexedTask(db, "Adjust lifecycle operation timeout for the fixture resource", {
		providerType: "resources",
		providerName: "fixture",
	});
	expect(result?.kind).toBe("choices");
	expect(result?.destinations.map(row => row.anchor).sort()).toEqual([
		"schema-timeouts--create",
		"schema-timeouts--delete",
		"schema-timeouts--read",
		"schema-timeouts--update",
	]);
	expect(
		resolveIndexedTask(db, "Explain lifecycle timeouts for the fixture resource", {
			providerType: "resources",
			providerName: "fixture",
		})?.kind,
	).toBe("leaf");
	expect(
		resolveIndexedTask(db, "Adjust lifecycle operation timeout invented_field for fixture resource", {
			providerType: "resources",
			providerName: "fixture",
		})?.kind,
	).toBe("none");
	expect(
		resolveIndexedTask(db, "Adjust lifecycle operation timeout for fixture resource", {
			providerType: "resources",
			providerName: "fixture",
			filters: [{ key: "category", value: "absent" }],
		})?.destinations,
	).toEqual([]);
	db.close();
});

test("maintained navigation destinations are exact and caller-scoped",()=>{
 const db=fixture(); const put=db.prepare("INSERT INTO terraform_documents VALUES(?,?,?,?,?,?,?)");const section=db.prepare("INSERT INTO terraform_sections VALUES(?,?,?,?,?)");
 put.run("root",null,"documentation/index.md","provider","xcsh","navigation","Provider documentation");section.run("documentation/index.md","xcsh-provider-documentation",0,"Provider documentation","Collections.");
 put.run("setup-guide",null,"documentation/provider/setup/index.md","provider","setup","overview","Provider setup");section.run("documentation/provider/setup/index.md","requirements",1,"Requirements","Terraform version.");
 expect(resolveIndexedTask(db,"Navigate the top-level collection index for xcsh provider documentation",{})?.destinations[0]?.anchor).toBe("xcsh-provider-documentation");
 expect(resolveIndexedTask(db,"Where is the root link to resources collection in xcsh provider documentation",{filters:[{key:"provider_type",value:"resources"}]})?.kind).toBe("none");
 expect(resolveIndexedTask(db,"What Terraform version is required by the xcsh provider to support actions",{})?.destinations[0]?.anchor).toBe("requirements");
 expect(resolveIndexedTask(db,"Navigate top-level xcsh documentation index",{node:"documentation/fixture/fundamentals/index.md"})?.kind).toBe("none");
 db.close();
});

test("documented provider environment names route to setup and unknown identifiers reject",()=>{
 const db=fixture();
 expect(resolveIndexedTask(db,"Configure environment variables XCSH_API_URL and XCSH_CACERT for provider authentication",{})?.destinations[0]?.anchor).toBe("option-3-pem-certificate-authentication");
 expect(resolveIndexedTask(db,"Configure environment variables XCSH_INVENTED_FIELD for provider authentication",{})?.destinations).toEqual([]);
 db.close();
});

test("maintained guide routing rejects competing identities and explicit unknown identifiers",()=>{
 const db=fixture();const put=db.prepare("INSERT INTO terraform_documents VALUES(?,?,?,?,?,?,?)");const section=db.prepare("INSERT INTO terraform_sections VALUES(?,?,?,?,?)");
 put.run("allowlists",null,"documentation/guides/network-allowlists/index.md","guides","network-allowlists","overview","Network allowlists");section.run("documentation/guides/network-allowlists/index.md","aws-https-origin-ingress",0,"AWS ingress","AWS HTTPS origin ingress.");
 expect(resolveIndexedTask(db,"Explain network allowlists documentation overview and link for AWS HTTPS origin ingress",{})?.destinations[0]?.anchor).toBe("aws-https-origin-ingress");
 expect(resolveIndexedTask(db,"What Terraform version is required for the AWS provider",{})).toBeUndefined();
 expect(resolveIndexedTask(db,"Network allowlists guide AWS HTTPS origin ingress invented_flag",{})?.kind).toBe("none");
 db.close();
});

test("environment auth routing keeps complete sections and excludes unrelated credential stores",()=>{
 const db=fixture();
 expect(resolveIndexedTask(db,"Authenticate provider with XCSH_INVENTED_FIELD",{})?.kind).toBe("none");
 expect(resolveIndexedTask(db,"Provider argument reference for environment variable XCSH_API_TOKEN authentication",{})?.destinations[0]?.anchor).toBe("option-1-api-token-authentication");
 expect(resolveIndexedTask(db,"Secret store provider credentials using XCSH_API_TOKEN",{})).toBeUndefined();
 db.close();
});

test("argument reference cannot route an unrelated secret-store credential request",()=>{
 const db=fixture();expect(resolveIndexedTask(db,"Secret store provider argument reference credentials using XCSH_API_TOKEN",{})).toBeUndefined();db.close();
});

test("environment clues retain explicit auth method and plural competing roles",()=>{
 const db=fixture();
 expect(resolveIndexedTask(db,"Configure provider PEM authentication using XCSH_API_URL",{})?.destinations[0]?.anchor).toBe("option-3-pem-certificate-authentication");
 expect(resolveIndexedTask(db,"Configure provider PEM authentication using XCSH_API_TOKEN",{})?.kind).toBe("choices");
 for(const role of ["data sources","resources","actions"]) expect(resolveIndexedTask(db,`Explain provider environment credentials for ${role} using XCSH_API_TOKEN`,{})).toBeUndefined();
 db.close();
});

test("plural action exclusions and explicit token-certificate conflicts remain accurate",()=>{
 const db=fixture();
 expect(resolveIndexedTask(db,"Provider argument reference for actions environment credentials using XCSH_API_TOKEN",{})).toBeUndefined();
 expect(resolveIndexedTask(db,"Provider PEM certificate authentication using XCSH_API_TOKEN",{})?.destinations.map(row=>row.anchor)).toContain("option-1-api-token-authentication");
 db.close();
});

test("variable-only argument questions read actual method content and external provider roots do not route",()=>{
 const db=fixture();
 expect(resolveIndexedTask(db,"Provider argument reference for XCSH_API_TOKEN",{})?.destinations[0]?.anchor).toBe("option-1-api-token-authentication");
 expect(resolveIndexedTask(db,"Navigate root documentation index for the AWS provider",{})).toBeUndefined();
 db.close();
});

test("explicit external provider credentials do not use XCSH setup and combined guides keep both sections",()=>{
 const db=fixture();expect(resolveIndexedTask(db,"AWS provider argument reference for XCSH_API_TOKEN",{})).toBeUndefined();
 const put=db.prepare("INSERT INTO terraform_documents VALUES(?,?,?,?,?,?,?)");const section=db.prepare("INSERT INTO terraform_sections VALUES(?,?,?,?,?)");put.run("guide",null,"documentation/guides/network-allowlists/index.md","guides","network-allowlists","overview","Network allowlists");
 for(const anchor of ["aws-https-origin-ingress","release-pinned-network-allowlists"])section.run("documentation/guides/network-allowlists/index.md",anchor,0,anchor,"Guide content.");
 expect(resolveIndexedTask(db,"Explain network allowlists guide release-pinned allowlists and AWS HTTPS origin ingress",{})?.destinations).toHaveLength(2);db.close();
});
