import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { resolveIndexedTask } from "../../src/internal-urls/terraform-task-route";

test("complete HCL draft verifies nested fields beyond minimal example", () => {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE terraform_documents(path TEXT,id TEXT,provider_type TEXT,provider_name TEXT,role TEXT,summary TEXT);CREATE TABLE terraform_sections(path TEXT,anchor TEXT,ordinal INT,context_markdown TEXT);CREATE TABLE terraform_destinations(provider_type TEXT,provider_name TEXT,schema_path TEXT);",
	);
	db.query("INSERT INTO terraform_documents VALUES(?,?,?,?,?,?)").run(
		"documentation/resources/fixture/index.md",
		"fixture",
		"resources",
		"fixture",
		"fundamentals",
		"Fixture.",
	);
	db.query("INSERT INTO terraform_sections VALUES(?,?,?,?)").run(
		"documentation/resources/fixture/index.md",
		"minimal-configuration",
		0,
		"name = sample",
	);
	db.query("INSERT INTO terraform_destinations VALUES(?,?,?)").run("resources", "fixture", "nested.optional_field");
	const scope = { providerType: "resources", providerName: "fixture", inferredIdentity: true };
	expect(
		resolveIndexedTask(db, 'Draft HCL for resource "xcsh_fixture" with nested.optional_field = 2', scope)?.kind,
	).toBe("leaf");
	expect(resolveIndexedTask(db, 'Draft HCL for resource "xcsh_fixture" with unsupported_field = 2', scope)?.kind).toBe(
		"none",
	);
	db.query("INSERT INTO terraform_documents VALUES(?,?,?,?,?,?)").run(
		"documentation/resources/fixture/examples/resource/index.md",
		"example",
		"resources",
		"fixture",
		"example",
		"Fixture example.",
	);
	db.query("INSERT INTO terraform_sections VALUES(?,?,?,?)").run(
		"documentation/resources/fixture/examples/resource/index.md",
		"resource",
		0,
		"name = sample",
	);
	const draft =
		"Draft Terraform HCL for a synthetic xcsh_fixture resource with nested.optional_field = 2. Use the standalone Resource example as the starting point.";
	const result = resolveIndexedTask(db, draft, scope);
	expect(result?.kind).toBe("leaf");
	expect(result?.destinations[0]?.path).toBe("documentation/resources/fixture/examples/resource/index.md");
	expect(resolveIndexedTask(db, draft.replace("nested.optional_field", "unsupported_field"), scope)?.kind).toBe(
		"none",
	);
	db.close();
});
