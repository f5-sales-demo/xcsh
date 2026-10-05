import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { terraformExampleContext } from "../../src/internal-urls/terraform-example-context";

test("example declaration context uses verified same-provider sections only", () => {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE terraform_documents(path TEXT,provider_type TEXT,provider_name TEXT,role TEXT);CREATE TABLE terraform_sections(path TEXT,anchor TEXT);",
	);
	db.query("INSERT INTO terraform_documents VALUES(?,?,?,?)").run(
		"documentation/resources/fixture/examples/resource/index.md",
		"resources",
		"fixture",
		"example",
	);
	for (const role of ["resources", "data-sources"]) {
		const path = `documentation/${role}/fixture/index.md`;
		db.query("INSERT INTO terraform_documents VALUES(?,?,?,?)").run(path, role, "fixture", "fundamentals");
		db.query("INSERT INTO terraform_sections VALUES(?,?)").run(path, "root-configuration");
	}
	const text = terraformExampleContext(db, "documentation/resources/fixture/examples/resource/index.md");
	expect(text).toContain("resources/fixture/index.md?view=context#root-configuration");
	expect(text).not.toContain("data-sources");
	expect(text).not.toContain("prerequisites:");
	expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1500);
	expect(terraformExampleContext(db, "documentation/resources/fixture/index.md")).toBe("");
	db.close();
});
