import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { buildFieldedIndex, searchFieldedIndex } from "./fielded-bm25";

const row = (schema_path: string, description: string) => ({
	provider_type: "resources",
	provider_name: "fixture",
	schema_path,
	path: `documentation/${schema_path}.md`,
	anchor: `schema-${schema_path}`,
	description,
});
test("requested field evidence separates ancestor description overlap", () => {
	const db = new Database(":memory:");
	buildFieldedIndex(
		db,
		[
			row("tls.listen_port", "Listening port for HTTPS requests"),
			row("tls.redirect", "Redirect HTTP traffic to HTTPS"),
		],
		"source",
	);
	expect(
		searchFieldedIndex(
			db,
			"Which field specifies the listening port for HTTPS?",
			{ providerName: "fixture" },
			"source",
		)[0]?.schema_path,
	).toBe("tls.listen_port");
	db.close();
});
test("fielded index binds source and preserves role and deterministic destinations", () => {
	const db = new Database(":memory:");
	const a = row("tls.port", "HTTPS port");
	buildFieldedIndex(db, [a, { ...a, provider_type: "data-sources", path: "data.md" }], "source");
	expect(searchFieldedIndex(db, "HTTPS port", { providerType: "resources" }, "source")).toHaveLength(1);
	expect(() => searchFieldedIndex(db, "HTTPS port", {}, "changed")).toThrow("source");
	expect(searchFieldedIndex(db, "HTTPS port", {}, "source")).toEqual(
		searchFieldedIndex(db, "HTTPS port", {}, "source"),
	);
	db.close();
});
