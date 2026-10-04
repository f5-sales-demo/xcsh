import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { populatePropertyIndex, searchPropertyEnumValue } from "../../src/internal-urls/terraform-property-index";

const rule = (values: string[], sensitive = true) => ({
	version: 1,
	validator: sensitive ? "OneOf" : "OneOfCaseInsensitive",
	values,
	case_sensitive: sensitive,
	complete: true,
	source:
		"ast-validator:github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator." +
		(sensitive ? "OneOf" : "OneOfCaseInsensitive"),
});
function fixture() {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description);CREATE TABLE terraform_documents(id,parent_id,path,metadata);CREATE TABLE terraform_facets(path,facet,value)",
	);
	const insert = db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
	for (const [name, path, evidence, complete] of [
		["selector", "selector", [rule(["GRE", "IPSEC"])], true],
		["intersection", "intersection", [rule(["GRE", "IPSEC"]), rule(["GRE"])], true],
		["case", "case", [rule(["gre"], false)], true],
		["unknown", "unknown", [rule(["GRE"])], false],
	] as const) {
		insert.run("resources", "fixture", name, path, "schema-" + name, "Tunnel protocol.");
		db.prepare("INSERT INTO terraform_documents VALUES(?,?,?,?)").run(
			path,
			null,
			path,
			JSON.stringify({
				provider_type: "resources",
				provider_name: "fixture",
				sections: [
					{
						schema_path: [name],
						document_id: path,
						anchor: "schema-" + name,
						enum_validators: evidence,
						enum_extraction_complete: complete,
					},
				],
			}),
		);
		db.prepare("INSERT INTO terraform_facets VALUES(?,?,?)").run(path, "task", "configuration");
	}
	populatePropertyIndex(db);
	return db;
}
test("indexed exact values preserve conjunctive and case semantics", () => {
	const db = fixture();
	expect(
		searchPropertyEnumValue(db, "IPSEC", { providerType: "resources", providerName: "fixture" }).map(
			r => r.schema_path,
		),
	).toEqual(["selector"]);
	expect(searchPropertyEnumValue(db, "GRE", { providerName: "fixture" }).map(r => r.schema_path)).toEqual([
		"case",
		"intersection",
		"selector",
	]);
	expect(searchPropertyEnumValue(db, "gre", { providerName: "fixture" }).map(r => r.schema_path)).toEqual(["case"]);
	expect(searchPropertyEnumValue(db, "GRE", { providerType: "data-sources" })).toEqual([]);
	expect(searchPropertyEnumValue(db, "unsupported", { providerName: "fixture" })).toEqual([]);
	db.close();
});
test("enum lookup filters retain AND facets and node scope", () => {
	const db = fixture();
	expect(
		searchPropertyEnumValue(db, "GRE", { node: "selector", filters: [{ key: "task", value: "configuration" }] }).map(
			r => r.schema_path,
		),
	).toEqual(["selector"]);
	expect(
		searchPropertyEnumValue(db, "GRE", { node: "selector", filters: [{ key: "task", value: "troubleshooting" }] }),
	).toEqual([]);
	expect(() => searchPropertyEnumValue(db, "GRE", { node: "missing" })).toThrow();
	db.close();
});
test("index stores typed evidence separately and uses value indexes", () => {
	const db = fixture();
	expect(db.query("SELECT count(*) n FROM property_enum_rules").get()).toEqual({ n: 5 });
	const plan = db.query("EXPLAIN QUERY PLAN SELECT * FROM property_enum_values WHERE value=?").all("GRE") as {
		detail: string;
	}[];
	expect(plan.some(row => row.detail.includes("INDEX"))).toBe(true);
	db.close();
});

test("missing legacy enum tables return no invented evidence", () => {
	const db = new Database(":memory:");
	expect(searchPropertyEnumValue(db, "GRE", {})).toEqual([]);
	db.close();
});
test("enum lookup rejects candidate overflow rather than claiming uniqueness", () => {
	const db = fixture();
	expect(() => searchPropertyEnumValue(db, "GRE", {}, 1)).toThrow("exceeds limit");
	db.close();
});

test("identical projection evidence deduplicates and conflicting evidence fails", () => {
	const create = (conflict: boolean) => {
		const db = new Database(":memory:");
		db.exec(
			"CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description);CREATE TABLE terraform_documents(metadata)",
		);
		db.exec(
			"INSERT INTO terraform_destinations VALUES('resources','fixture','protocol','p','schema-protocol','Protocol')",
		);
		for (const value of [true, conflict ? false : true])
			db.prepare("INSERT INTO terraform_documents VALUES(?)").run(
				JSON.stringify({
					provider_type: "resources",
					provider_name: "fixture",
					sections: [
						{ schema_path: ["protocol"], enum_validators: [rule(["GRE"])], enum_extraction_complete: value },
					],
				}),
			);
		return db;
	};
	const db = create(false);
	expect(() => populatePropertyIndex(db)).not.toThrow();
	expect(searchPropertyEnumValue(db, "GRE", {})).toHaveLength(1);
	db.close();
	const bad = create(true);
	expect(() => populatePropertyIndex(bad)).toThrow("Conflicting");
	bad.close();
});
test("partial enum table sets fail closed", () => {
	for (const name of [
		"property_enum_provenance",
		"property_enum_rules",
		"property_enum_coverage",
		"property_enum_values",
	]) {
		const db = fixture();
		db.exec(`DROP TABLE ${name}`);
		expect(() => searchPropertyEnumValue(db, "GRE", {})).toThrow("Incomplete");
		db.close();
	}
});

test("complete scoped enum lookup seeks both value indexes", () => {
	const db = fixture();
	let sql = "",
		args: unknown[] = [];
	const observed = new Proxy(db, {
		get(target, key) {
			if (key !== "query") return Reflect.get(target, key, target);
			return (text: string) => {
				const statement = target.query(text);
				if (!text.includes("SELECT DISTINCT p.provider_type")) return statement;
				sql = text;
				return {
					all(...values: unknown[]) {
						args = values;
						return statement.all(...(values as any[]));
					},
				};
			};
		},
	});
	searchPropertyEnumValue(observed, "GRE", { providerType: "resources", providerName: "fixture" });
	expect(sql).toContain("INDEXED BY property_enum_exact");
	const plan = db.query("EXPLAIN QUERY PLAN " + sql).all(...(args as any[])) as { detail: string }[];
	expect(plan.some(row => row.detail.includes("property_enum_exact") && row.detail.includes("SEARCH"))).toBe(true);
	expect(plan.some(row => row.detail.includes("property_enum_fold") && row.detail.includes("SEARCH"))).toBe(true);
	db.close();
});

test("duplicate enum records still validate property shape and flags", () => {
	for (const change of [{ type: "number" }, { flags: ["computed"] }]) {
		const db = new Database(":memory:");
		db.exec(
			"CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description);CREATE TABLE terraform_documents(metadata)",
		);
		db.exec(
			"INSERT INTO terraform_destinations VALUES('resources','fixture','protocol','p','schema-protocol','Protocol')",
		);
		const section = {
			schema_path: ["protocol"],
			type: "string",
			flags: ["optional"],
			enum_validators: [rule(["GRE"])],
			enum_extraction_complete: true,
		};
		for (const value of [section, { ...section, ...change }])
			db.prepare("INSERT INTO terraform_documents VALUES(?)").run(
				JSON.stringify({ provider_type: "resources", provider_name: "fixture", sections: [value] }),
			);
		expect(() => populatePropertyIndex(db)).toThrow("Conflicting property");
		db.close();
	}
});

test("equivalent rule object key ordering cannot create a projection conflict", () => {
	const db = new Database(":memory:");
	db.exec(
		"CREATE TABLE terraform_destinations(provider_type,provider_name,schema_path,path,anchor,description);CREATE TABLE terraform_documents(metadata)",
	);
	db.exec(
		"INSERT INTO terraform_destinations VALUES('resources','fixture','protocol','p','schema-protocol','Protocol')",
	);
	const original = rule(["GRE"]);
	for (const evidence of [original, Object.fromEntries(Object.entries(original).reverse())])
		db.prepare("INSERT INTO terraform_documents VALUES(?)").run(
			JSON.stringify({
				provider_type: "resources",
				provider_name: "fixture",
				sections: [{ schema_path: ["protocol"], enum_validators: [evidence], enum_extraction_complete: true }],
			}),
		);
	expect(() => populatePropertyIndex(db)).not.toThrow();
	expect(searchPropertyEnumValue(db, "GRE", {})).toHaveLength(1);
	db.close();
});
