import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { lookupTerraformAlias } from "../../src/internal-urls/terraform-alias-lookup";

function fixture() {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE terraform_aliases(provider_type TEXT,provider_name TEXT,alias TEXT,path TEXT,anchor TEXT,PRIMARY KEY(provider_type,provider_name,alias,path,anchor));CREATE TABLE terraform_documents(path TEXT,id TEXT,parent_id TEXT);CREATE TABLE terraform_facets(path TEXT,facet TEXT,value TEXT);CREATE TABLE terraform_sections(path TEXT,anchor TEXT,PRIMARY KEY(path,anchor));",
	);
	db.query("INSERT INTO terraform_documents VALUES(?,?,?)").run("root", "root", null);
	for (const role of ["resources", "data-sources"])
		for (const branch of ["a", "b"]) {
			const path = `documentation/${role}/fixture/${branch}/index.md`;
			db.query("INSERT INTO terraform_aliases VALUES(?,?,?,?,?)").run(
				role,
				"fixture",
				"automatic certificates",
				path,
				"section",
			);
			db.query("INSERT INTO terraform_documents VALUES(?,?,?)").run(path, role + branch, "root");
			db.query("INSERT INTO terraform_sections VALUES(?,?)").run(path, "section");
			db.query("INSERT INTO terraform_facets VALUES(?,?,?)").run(
				path,
				"category",
				branch === "a" ? "dns" : "security",
			);
		}
	return db;
}
test("exact alias retains all branch destinations in resolved role without prose interpretation", () => {
	const db = fixture();
	try {
		expect(
			lookupTerraformAlias(db, "automatic certificates", { providerType: "resources", providerName: "fixture" }),
		).toHaveLength(2);
		expect(
			lookupTerraformAlias(db, "not automatic certificates", { providerType: "resources", providerName: "fixture" }),
		).toEqual([]);
		expect(
			lookupTerraformAlias(db, "automatic certificate", { providerType: "resources", providerName: "fixture" }),
		).toEqual([]);
	} finally {
		db.close();
	}
});
test("exact alias preserves AND facets, verified node scope and deterministic identities", () => {
	const db = fixture();
	try {
		const scope = {
			providerType: "resources",
			providerName: "fixture",
			filters: [{ key: "category", value: "security" }],
			node: "root",
		};
		expect(lookupTerraformAlias(db, "automatic certificates", scope).map(r => r.id)).toEqual(["resourcesb"]);
		expect(
			lookupTerraformAlias(db, "automatic certificates", {
				...scope,
				filters: [...scope.filters, { key: "category", value: "dns" }],
			}),
		).toEqual([]);
		expect(() => lookupTerraformAlias(db, "automatic certificates", { ...scope, node: "missing" })).toThrow();
	} finally {
		db.close();
	}
});

test("missing anchor aliases are never returned as verified destinations", () => {
	const db = fixture();
	try {
		db.query("DELETE FROM terraform_sections WHERE path LIKE ?").run("%/b/%");
		const rows = lookupTerraformAlias(db, "automatic certificates", {
			providerType: "resources",
			providerName: "fixture",
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe("resourcesa");
	} finally {
		db.close();
	}
});
