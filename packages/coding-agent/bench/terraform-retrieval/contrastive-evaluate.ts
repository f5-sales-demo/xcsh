import { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { preparePropertyScope, rankPropertyScope, propertyTerms, type PropertyCandidate } from "./contrastive-ranking";
import {
	terraformProviderMention,
	terraformQueryIdentity,
	rankTerraformProviderNames,
	terraformHash,
	rankTerraformDirectProperties,
	terraformTimeoutOperations,
} from "../../src/internal-urls/terraform-documentation";
const args = process.argv.slice(2);
const arg = (key: string) => {
	const index = args.indexOf(key);
	return index < 0 ? undefined : args[index + 1];
};
const index = arg("--index"),
	suitePath = arg("--suite"),
	output = arg("--output");
if (!index || !suitePath || !output) throw new Error("--index, --suite and --output required");
const db = new Database(index, { readonly: true });
const start = performance.now();
const rows = db
	.query(
		"SELECT provider_type,provider_name,schema_path,path,anchor,description FROM terraform_destinations ORDER BY provider_type,provider_name,schema_path",
	)
	.all() as PropertyCandidate[];
const groups = new Map<string, PropertyCandidate[]>();
for (const row of rows) {
	const key = `${row.provider_type}|${row.provider_name}`;
	const group = groups.get(key) ?? [];
	group.push(row);
	groups.set(key, group);
}
const scopes = new Map([...groups].map(([key, group]) => [key, preparePropertyScope(group)]));
const scopePreparationMs = performance.now() - start;
const search = new Database(":memory:");
search.exec("CREATE VIRTUAL TABLE candidates USING fts5(terms,scope UNINDEXED,destination UNINDEXED)");
const insert = search.prepare("INSERT INTO candidates VALUES(?,?,?)");
search.transaction(() => {
	for (const [key, scope] of scopes)
		for (const row of scope.rows)
			insert.run([...row.leaf, ...row.context, ...row.descriptionTerms].join(" "), key, `${row.path}#${row.anchor}`);
})();
const preparationMs = performance.now() - start;
const metadata = new Map(
	(db.query("SELECT path,metadata FROM terraform_documents").all() as { path: string; metadata: string }[]).map(
		row => [row.path, JSON.parse(row.metadata)],
	),
);
const suiteBytes = await readFile(suitePath);
const suite = JSON.parse(suiteBytes.toString());
const cases = (suite.cases ?? suite).map((item: any, index: number) => ({
	...item,
	id: item.id ?? `development-${index + 1}`,
}));
const results = [];
const timings: number[] = [];
for (const item of cases) {
	const role = terraformQueryIdentity(item.prompt).providerType;
	const names = [...new Set(rows.filter(row => !role || row.provider_type === role).map(row => row.provider_name))];
	let provider = terraformProviderMention(item.prompt, names);
	if (!provider && role === "actions") {
		const ranked = rankTerraformProviderNames(item.prompt, names);
		if (ranked[0] && (!ranked[1] || ranked[0].score >= ranked[1].score + 10)) provider = ranked[0].name;
	}
	const selected = [...scopes].filter(([key]) => {
		const [type, name] = key.split("|");
		return (!role || type === role) && (!provider || name === provider);
	});
	let ranked: ReturnType<typeof rankPropertyScope> = [];
	const times = [];
	for (let n = 0; n < 5; n++) {
		const before = performance.now();
		const query = propertyTerms(item.prompt)
			.map(term => `"${term}"`)
			.join(" OR ");
		const clauses = ["candidates MATCH ?"];
		const values: Array<string> = [query];
		clauses.push(`scope IN (${selected.map(() => "?").join(",")})`);
		values.push(...selected.map(([key]) => key));
		const pool = search
			.query(
				`SELECT destination FROM candidates WHERE ${clauses.join(" AND ")} ORDER BY bm25(candidates),destination LIMIT 500`,
			)
			.all(...values) as { destination: string }[];
		const destinations = new Set(pool.map(row => row.destination));
		ranked = selected
			.flatMap(([, scope]) => rankPropertyScope(item.prompt, scope, destinations))
			.sort(
				(a, b) =>
					b.score - a.score ||
					(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
					(a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
			);
		times.push(performance.now() - before);
	}
	timings.push(...times);
	const top = ranked[0];
	if (top?.anchor === "section") {
		const m = metadata.get(top.path);
		const refined = rankTerraformDirectProperties(item.prompt, m.schema_path, m.sections ?? []);
		if (refined[0]?.document_id === m.id) {
			const field = rows.find(row => row.path === top.path && row.anchor === refined[0].anchor);
			if (field) ranked = [{ ...field, score: top.score, coverage: top.coverage }, ...ranked.slice(1)];
		}
	}
	const operations = terraformTimeoutOperations(item.prompt);
	if (provider && operations.length) {
		const fields = rows.filter(
			row =>
				row.provider_name === provider &&
				(!role || row.provider_type === role) &&
				operations.some(operation => row.schema_path === `timeouts.${operation}`),
		);
		if (fields.length) ranked = fields.map(row => ({ ...row, score: 100, coverage: 1 }));
	}
	const destinations = ranked.slice(0, 5).map(row => `xcsh://terraform-documentation/${row.path}#${row.anchor}`);
	results.push({
		id: item.id,
		kind: item.kind,
		provider,
		role,
		first: destinations[0] === item.expected[0],
		top5: item.expected.some((uri: string) => destinations.includes(uri)),
		destinations,
		ranked: ranked.slice(0, 5),
		times_ms: times,
	});
}
const propertyIds = new Set(
	cases
		.filter((item: any) => item.kind === "answerable" && item.expected[0]?.includes("/properties/"))
		.map((item: any) => item.id),
);
const properties = results.filter(row => propertyIds.has(row.id));
const pin = JSON.parse((db.query("SELECT pin FROM terraform_provenance").get() as { pin: string }).pin);
const report = {
	development_only: true,
	qualification_passed: false,
	production_promoted: false,
	suite_sha256: terraformHash(suiteBytes),
	source_commit: pin.source_commit,
	provider_version: pin.provider_version,
	property_cases: properties.length,
	property_first: properties.filter(row => row.first).length,
	property_top5: properties.filter(row => row.top5).length,
	preparation_ms: preparationMs,
	scope_preparation_ms: scopePreparationMs,
	ranking_p95_ms: timings.sort((a, b) => a - b)[Math.ceil(timings.length * 0.95) - 1],
	limitations: [
		"Indexed candidate query and ranking only; excludes post-ranking direct-field refinement, lifecycle routing, response rendering and confidence selection.",
		"Development labels have known defects and unresolved same-role ambiguities.",
		"Experimental in-memory FTS limits ranking to 500 candidates; production integration and complete response timing remain unverified.",
	],
	results,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, results: undefined }));
search.close();
db.close();
