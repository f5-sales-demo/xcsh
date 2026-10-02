import { Database } from "bun:sqlite";
import { readFile, writeFile, stat } from "node:fs/promises";
import { populatePropertyIndex, searchPropertyIndex } from "./property-index";
import {
	terraformProviderMention,
	terraformQueryIdentity,
	rankTerraformProviderNames,
	terraformHash,
} from "../../src/internal-urls/terraform-documentation";
const args = process.argv.slice(2);
const arg = (key: string) => {
	const i = args.indexOf(key);
	return i < 0 ? undefined : args[i + 1];
};
const sourcePath = arg("--source"),
	indexPath = arg("--index"),
	suitePath = arg("--suite"),
	output = arg("--output");
if (!sourcePath || !indexPath || !suitePath || !output) throw new Error("Required source, index, suite, output");
const source = new Database(sourcePath, { readonly: true });
const start = performance.now();
const db = new Database(indexPath, { create: true });
if (!db.query("SELECT 1 FROM sqlite_master WHERE name='property_terms'").get()) {
	db.exec(
		"CREATE TABLE terraform_destinations(provider_type TEXT,provider_name TEXT,schema_path TEXT,path TEXT,anchor TEXT,description TEXT)",
	);
	const insert = db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
	const rows = source
		.query(
			"SELECT provider_type,provider_name,schema_path,path,anchor,description FROM terraform_destinations ORDER BY provider_type,provider_name,schema_path",
		)
		.all() as any[];
	db.transaction(() => {
		for (const r of rows)
			insert.run(r.provider_type, r.provider_name, r.schema_path, r.path, r.anchor, r.description);
	})();
	populatePropertyIndex(db);
	db.exec("VACUUM");
}
const buildMs = performance.now() - start;
const names = source
	.query("SELECT DISTINCT provider_type,provider_name FROM terraform_documents ORDER BY provider_type,provider_name")
	.all() as { provider_type: string; provider_name: string }[];
const bytes = await readFile(suitePath);
const suite = JSON.parse(bytes.toString());
const cases = (suite.cases ?? suite).map((c: any, i: number) => ({ ...c, id: c.id ?? `development-${i + 1}` }));
const results = [];
const times: number[] = [];
for (const item of cases) {
	const role = terraformQueryIdentity(item.prompt).providerType;
	const scopedNames = names.filter(row => !role || row.provider_type === role).map(row => row.provider_name);
	let provider = terraformProviderMention(item.prompt, scopedNames);
	if (!provider && role === "actions") {
		const ranked = rankTerraformProviderNames(item.prompt, scopedNames);
		if (ranked[0] && (!ranked[1] || ranked[0].score >= ranked[1].score + 10)) provider = ranked[0].name;
	}
	let ranked: ReturnType<typeof searchPropertyIndex> = [];
	const samples = [];
	for (let n = 0; n < 5; n++) {
		const begin = performance.now();
		ranked = searchPropertyIndex(db, item.prompt, { providerType: role, providerName: provider });
		samples.push(performance.now() - begin);
	}
	times.push(...samples);
	const destinations = ranked.slice(0, 5).map(r => `xcsh://terraform-documentation/${r.path}#${r.anchor}`);
	results.push({
		id: item.id,
		kind: item.kind,
		provider,
		role,
		first: destinations[0] === item.expected[0],
		top5: item.expected.some((uri: string) => destinations.includes(uri)),
		destinations,
		ranked: ranked.slice(0, 5),
		times_ms: samples,
	});
}
const propertyIds = new Set(
	cases.filter((c: any) => c.kind === "answerable" && c.expected[0]?.includes("/properties/")).map((c: any) => c.id),
);
const properties = results.filter(r => propertyIds.has(r.id));
const pin = JSON.parse((source.query("SELECT pin FROM terraform_provenance").get() as { pin: string }).pin);
const report = {
	development_only: true,
	qualification_passed: false,
	production_promoted: false,
	source_commit: pin.source_commit,
	suite_sha256: terraformHash(bytes),
	property_cases: properties.length,
	property_first: properties.filter(r => r.first).length,
	property_top5: properties.filter(r => r.top5).length,
	index_build_ms: buildMs,
	index_bytes: (await stat(indexPath)).size,
	index_sha256: terraformHash(await readFile(indexPath)),
	ranking_p95_ms: times.sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1],
	limitations: [
		"Targeted prepared-term SQL prototype; excludes complete response rendering, selection and installed acceptance.",
		"Source labels contain known defects.",
	],
	results,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, results: undefined }));
db.close();
source.close();
