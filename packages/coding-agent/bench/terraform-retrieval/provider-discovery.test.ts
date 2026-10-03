import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { buildProviderDiscovery, searchProviderDiscovery, validateProviderDiscovery } from "./provider-discovery";

test("indexed provider descriptions identify operations without binding incidental nouns", () => {
	const db = new Database(":memory:");
	buildProviderDiscovery(db, [
		{
			provider_type: "actions",
			provider_name: "site_upgrade_os",
			path: "os",
			summary: "Upgrade the site operating system",
			aliases: ["site OS upgrade"],
			facets: [{ key: "task", value: "lifecycle" }],
		},
		{
			provider_type: "resources",
			provider_name: "authentication",
			path: "auth",
			summary: "Configure authentication cookies",
			aliases: [],
			facets: [],
		},
	]);
	expect(searchProviderDiscovery(db, "upgrade a site operating system", {}).map(r => r.provider_name)[0]).toBe(
		"site_upgrade_os",
	);
	expect(searchProviderDiscovery(db, "upgrade a site operating system", { providerType: "resources" })).toEqual([]);
	expect(
		searchProviderDiscovery(db, "upgrade a site operating system", {
			filters: [{ key: "task", value: "authentication" }],
		}),
	).toEqual([]);
	db.close();
});
test("same provider roles remain distinct and ties deterministic", () => {
	const db = new Database(":memory:");
	const row = {
		provider_name: "fixture",
		summary: "Read or configure network routing",
		aliases: ["network fixture"],
		facets: [],
	};
	buildProviderDiscovery(db, [
		{ ...row, provider_type: "resources", path: "resource" },
		{ ...row, provider_type: "data-sources", path: "data" },
	]);
	const results = searchProviderDiscovery(db, "network routing", {});
	expect(results).toHaveLength(2);
	expect(results[0]?.provider_type).toBe("data-sources");
	expect(searchProviderDiscovery(db, "network routing", {})).toEqual(results);
	db.close();
});

test("duplicate navigation records cannot crowd out distinct provider choices", () => {
	const db = new Database(":memory:");
	const rows = Array.from({ length: 8 }, (_, n) => ({
		provider_type: "resources",
		provider_name: "alpha",
		path: `alpha-${n}`,
		summary: "network routing",
		aliases: [],
		facets: [],
	}));
	buildProviderDiscovery(db, [
		...rows,
		{
			provider_type: "resources",
			provider_name: "beta",
			path: "beta",
			summary: "network routing",
			aliases: [],
			facets: [],
		},
	]);
	expect(searchProviderDiscovery(db, "network routing", {}, 5).map(r => r.provider_name)).toEqual(["alpha", "beta"]);
	db.close();
});

test("provider index rejects changed source and format", () => {
	const db = new Database(":memory:");
	buildProviderDiscovery(db, [], { sourceCommit: "a", sourceIndexSha256: "b" });
	expect(() => validateProviderDiscovery(db, { sourceCommit: "a", sourceIndexSha256: "b" })).not.toThrow();
	expect(() => validateProviderDiscovery(db, { sourceCommit: "c", sourceIndexSha256: "b" })).toThrow("source");
	db.exec("UPDATE provider_discovery_provenance SET schema_version=99");
	expect(() => validateProviderDiscovery(db, { sourceCommit: "a", sourceIndexSha256: "b" })).toThrow("version");
	db.close();
});
