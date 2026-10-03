// Development-only reviewed alias recall. No production import.
import { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	terraformHash,
	terraformProviderMention,
	terraformQueryIdentity,
} from "../../src/internal-urls/terraform-documentation";
import {
	type PropertyCandidate,
	preparePropertyScope,
	rankPropertyScope,
} from "../../src/internal-urls/terraform-property-ranking";

const args = process.argv.slice(2);
const arg = (key: string) => args[args.indexOf(key) + 1]!;
const suitePath = arg("--suite");
if (await Bun.file(path.join(path.dirname(suitePath), "eligibility.json")).exists())
	throw new Error("Qualification suites require a separate qualified harness");
const db = new Database(arg("--source"), { readonly: true });
const raw = await readFile(suitePath);
const parsed = JSON.parse(raw.toString());
const rows = db
	.query(
		"SELECT provider_type,provider_name,schema_path,path,anchor,description FROM terraform_destinations ORDER BY provider_type,provider_name,schema_path",
	)
	.all() as PropertyCandidate[];
const reviewed = args.includes("--reviewed-rules")
	? (JSON.parse(await readFile(arg("--reviewed-rules"), "utf8")).summaries as Array<{
			provider_type: string;
			collection: string;
			schema_path: string[];
			summary: string;
			aliases?: string[];
		}>)
	: [];
const aliases = db
	.query(
		"SELECT provider_type,provider_name,path,anchor,alias FROM terraform_aliases ORDER BY provider_type,provider_name,path,anchor,alias",
	)
	.all() as Array<{ provider_type: string; provider_name: string; path: string; anchor: string; alias: string }>;
const aliasMap = new Map<string, string[]>();
for (const row of aliases) {
	const key = `${row.provider_type}|${row.provider_name}|${row.path}#${row.anchor}`;
	aliasMap.set(key, [...(aliasMap.get(key) ?? []), row.alias]);
}
const groups = new Map<string, PropertyCandidate[]>();
for (const row of rows) {
	const key = `${row.provider_type}|${row.provider_name}`;
	const matching = reviewed.filter(
		rule =>
			rule.provider_type === row.provider_type &&
			["*", row.provider_name].includes(rule.collection) &&
			rule.schema_path.join(".") === row.schema_path,
	);
	const rule = matching.find(rule => rule.collection === row.provider_name) ?? matching[0];
	const hints = aliasMap.get(`${key}|${row.path}#${row.anchor}`) ?? [];
	groups.set(key, [
		...(groups.get(key) ?? []),
		{ ...row, description: [rule?.summary ?? row.description, ...hints, ...(rule?.aliases ?? [])].join(" ") },
	]);
}
const scopes = new Map([...groups].map(([key, value]) => [key, preparePropertyScope(value)]));
const names = [...new Set(rows.map(row => row.provider_name))].sort();
const results = [];
for (const [index, c] of (parsed.cases ?? parsed).entries()) {
	const role = terraformQueryIdentity(c.prompt).providerType;
	const provider = terraformProviderMention(c.prompt, names);
	const scopeList = [...scopes.values()].filter(
		scope =>
			(!role || scope.rows[0]!.provider_type === role) && (!provider || scope.rows[0]!.provider_name === provider),
	);
	const times = [];
	let destinations: string[] = [];
	let previous: string | undefined;
	for (let repeat = 0; repeat < 5; repeat++) {
		const before = performance.now();
		const candidates = scopeList
			.flatMap(scope => rankPropertyScope(c.prompt, scope))
			.sort(
				(a, b) =>
					b.score - a.score ||
					(a.path < b.path ? -1 : a.path > b.path ? 1 : a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
			);
		destinations = candidates.slice(0, 5).map(row => `xcsh://terraform-documentation/${row.path}#${row.anchor}`);
		const fingerprint = JSON.stringify(destinations);
		if (previous && previous !== fingerprint) throw new Error("Non-deterministic alias candidates");
		previous = fingerprint;
		times.push(performance.now() - before);
	}
	results.push({
		id: c.id ?? `development-${index + 1}`,
		kind: c.kind,
		destinations,
		top1: destinations.length > 0 && c.expected.includes(destinations[0]),
		top5: destinations.some(uri => c.expected.includes(uri)),
		candidate_ms: times,
	});
}
const answerable = results.filter(row => row.kind === "answerable");
await writeFile(
	arg("--output"),
	JSON.stringify(
		{
			development_only: true,
			qualification_passed: false,
			production_imported: false,
			reviewed_rules_sha256: args.includes("--reviewed-rules")
				? terraformHash(await readFile(arg("--reviewed-rules")))
				: null,
			suite_sha256: terraformHash(raw),
			source_index_sha256: terraformHash(await readFile(arg("--source"))),
			answerable: answerable.length,
			top1: answerable.filter(row => row.top1).length,
			top5: answerable.filter(row => row.top5).length,
			limitations: [
				"Complete in-memory scope candidate experiment; indexed performance, selection, and rendering are not measured.",
				"Reviewed aliases appended only to development scoring text; authoritative source unchanged.",
			],
			results,
		},
		null,
		2,
	) + "\n",
);
db.close();
