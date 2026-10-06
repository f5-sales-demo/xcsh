import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { terraformConflictContext } from "../../src/internal-urls/terraform-conflict-context";

function fixture() {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE terraform_relationships(path TEXT,anchor TEXT,type TEXT,target_path TEXT,target_anchor TEXT,enforcement TEXT,source TEXT,choice_group TEXT);CREATE TABLE terraform_destinations(path TEXT,anchor TEXT,schema_path TEXT,description TEXT,provider_type TEXT,provider_name TEXT);CREATE TABLE terraform_sections(path TEXT,anchor TEXT);",
	);
	for (const [anchor, name, description] of [
		["schema-preserve", "listener.preserve", "Preserves an existing header."],
		["schema-replace", "listener.replace", "Overwrites an existing header."],
	]) {
		db.query("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)").run(
			"doc.md",
			anchor,
			name,
			description,
			"resources",
			"fixture",
		);
		db.query("INSERT INTO terraform_sections VALUES(?,?)").run("doc.md", anchor);
	}
	db.query("INSERT INTO terraform_relationships VALUES(?,?,?,?,?,?,?,?)").run(
		"doc.md",
		"schema-preserve",
		"conflicts",
		"doc.md",
		"schema-replace",
		"provider-schema",
		"ast-validator",
		"group",
	);
	return db;
}
test("verified scalar conflicts expose exact meanings and destinations without selection", () => {
	const db = fixture();
	try {
		const result = terraformConflictContext(db, "doc.md", "schema-preserve");
		expect(result).toContain("listener.replace");
		expect(result).toContain("Overwrites an existing header.");
		expect(result).toContain("doc.md?view=context#schema-replace");
		expect(result).toContain("not prerequisites");
		expect(result).not.toContain("Selected leaf");
	} finally {
		db.close();
	}
});
test("advisory, missing anchors and duplicate relationships cannot invent alternatives", () => {
	const db = fixture();
	try {
		db.query("INSERT INTO terraform_relationships SELECT * FROM terraform_relationships").run();
		expect(terraformConflictContext(db, "doc.md", "schema-preserve").match(/listener.replace/g)).toHaveLength(1);
		db.query("UPDATE terraform_relationships SET enforcement='upstream-advisory'").run();
		expect(terraformConflictContext(db, "doc.md", "schema-preserve")).toBe("");
		db.query("UPDATE terraform_relationships SET enforcement='provider-schema'").run();
		db.query("DELETE FROM terraform_sections WHERE anchor='schema-replace'").run();
		expect(terraformConflictContext(db, "doc.md", "schema-preserve")).toBe("");
	} finally {
		db.close();
	}
});
test("comparison is bounded and oversized descriptions remain at their complete-read destinations", () => {
	const db = fixture();
	try {
		db.query("UPDATE terraform_destinations SET description=? WHERE anchor=?").run(
			"🧪".repeat(4000),
			"schema-replace",
		);
		const result = terraformConflictContext(db, "doc.md", "schema-preserve");
		expect(Buffer.byteLength(result)).toBeLessThanOrEqual(2048);
		expect(result).toContain("Read its complete section");
		expect(result).not.toContain("🧪");
	} finally {
		db.close();
	}
});

test("row and byte limits provide complete-document recovery for omitted peers", () => {
	const db = fixture();
	try {
		for (let i = 0; i < 5; i++) {
			const anchor = `schema-peer${i}`;
			db.query("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)").run(
				"doc.md",
				anchor,
				`listener.peer${i}`,
				"x".repeat(1000),
				"resources",
				"fixture",
			);
			db.query("INSERT INTO terraform_sections VALUES(?,?)").run("doc.md", anchor);
			db.query("INSERT INTO terraform_relationships VALUES(?,?,?,?,?,?,?,?)").run(
				"doc.md",
				"schema-preserve",
				"conflicts",
				"doc.md",
				anchor,
				"provider-schema",
				"ast-validator",
				"group",
			);
		}
		const result = terraformConflictContext(db, "doc.md", "schema-preserve");
		expect(result).toContain("may be omitted");
		expect(result).toContain("doc.md?view=full");
		expect(Buffer.byteLength(result)).toBeLessThanOrEqual(2048);
	} finally {
		db.close();
	}
});

test("cross-document peers remain typed links and long recovery paths cannot abort source reads", () => {
	const db = fixture();
	try {
		db.query("UPDATE terraform_relationships SET target_path=?").run("other.md");
		db.query("UPDATE terraform_destinations SET path=? WHERE anchor=?").run("other.md", "schema-replace");
		db.query("UPDATE terraform_sections SET path=? WHERE anchor=?").run("other.md", "schema-replace");
		expect(terraformConflictContext(db, "doc.md", "schema-preserve")).toBe("");
		const long = "x".repeat(1900) + ".md";
		db.query("UPDATE terraform_relationships SET path=?,target_path=?").run(long, long);
		db.query("UPDATE terraform_destinations SET path=?").run(long);
		db.query("UPDATE terraform_sections SET path=?").run(long);
		expect(terraformConflictContext(db, long, "schema-preserve")).toBe("");
	} finally {
		db.close();
	}
});
