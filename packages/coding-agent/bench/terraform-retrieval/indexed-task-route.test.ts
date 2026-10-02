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
		db.prepare("INSERT INTO terraform_documents VALUES(?,?,?,?,?,?,?)").run(name, null, path, "actions", name, "fundamentals", "Terminate access sessions");
		db.prepare("INSERT INTO terraform_sections VALUES(?,?,?,?,?)").run(path, "minimal-configuration", 0, "Minimal configuration", "Complete documented action.");
	}
	const scope = { providerName: "access_active_sessions_terminate", providerType: "actions", inferredIdentity: true };
	expect(resolveIndexedTask(db, "Which action revokes active user access sessions?", scope)?.kind).toBe("choices");
	expect(resolveIndexedTask(db, "Which action revokes multiple active user access sessions?", scope)?.kind).toBe("leaf");
	expect(resolveIndexedTask(db, "How do I invoke xcsh_access_active_sessions_terminate action?", scope)?.kind).toBe("leaf");
	db.close();
});
