// Development-only comparison; exposed suites require explicit regression.
import { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	terraformHash,
	terraformProviderMention,
	terraformQueryIdentity,
} from "../../src/internal-urls/terraform-documentation";
import { searchGloballyWeightedProperties } from "./global-property-search";
import { populateGlobalWeights } from "./global-property-weights";
import { validateQualificationEligibility } from "./score";

const args = process.argv.slice(2),
	arg = (k: string) => args[args.indexOf(k) + 1];
const db = new Database(arg("--source"), { readonly: true }),
	global = new Database(arg("--weights"), { create: true });
const sourceHash = terraformHash(await readFile(arg("--source"))),
	raw = await readFile(arg("--suite"));
const eligibility = path.join(path.dirname(arg("--suite")), "eligibility.json"),
	regression = args.includes("--regression");
if (await Bun.file(eligibility).exists())
	validateQualificationEligibility(JSON.parse(await readFile(eligibility, "utf8")), terraformHash(raw), regression);
const start = performance.now();
if (!global.query("SELECT 1 FROM sqlite_master WHERE name=?").get("global_property_weights")) {
	const rows = db
		.query(
			"SELECT leaf,context,description_terms FROM property_terms ORDER BY provider_type,provider_name,schema_path",
		)
		.all() as Array<{ leaf: string; context: string; description_terms: string }>;
	populateGlobalWeights(
		global,
		rows.map(r => [...JSON.parse(r.leaf), ...JSON.parse(r.context), ...JSON.parse(r.description_terms)]),
		sourceHash,
	);
}
const buildMs = performance.now() - start;
const parsed = JSON.parse(raw.toString()),
	cases = parsed.cases ?? parsed;
const results = [],
	times: number[] = [];
for (const [i, c] of cases.entries()) {
	const role = terraformQueryIdentity(c.prompt).providerType;
	const names = (
		db
			.query(
				"SELECT DISTINCT provider_name FROM terraform_documents WHERE (? IS NULL OR provider_type=?) ORDER BY provider_name",
			)
			.all(role ?? null, role ?? null) as Array<{ provider_name: string }>
	).map(r => r.provider_name);
	const provider = terraformProviderMention(c.prompt, names);
	let ranked: ReturnType<typeof searchGloballyWeightedProperties> = [];
	for (let n = 0; n < 5; n++) {
		const before = performance.now();
		ranked = searchGloballyWeightedProperties(
			db,
			global,
			sourceHash,
			c.prompt,
			{ providerType: role, providerName: provider },
			500,
		);
		times.push(performance.now() - before);
	}
	const destinations = ranked.slice(0, 5).map(r => `xcsh://terraform-documentation/${r.path}#${r.anchor}`);
	results.push({
		id: c.id ?? `development-${i + 1}`,
		kind: c.kind,
		provider,
		role,
		top1: c.expected.includes(destinations[0]),
		top5: c.expected.some((u: string) => destinations.includes(u)),
		ranked: ranked.slice(0, 5),
	});
}
const answerable = results.filter(r => r.kind === "answerable");
const report = {
	development_only: true,
	post_analysis_regression: regression,
	qualification_passed: false,
	production_imported: false,
	source_index_sha256: sourceHash,
	suite_sha256: terraformHash(raw),
	build_ms: buildMs,
	answerable: answerable.length,
	top1: answerable.filter(r => r.top1).length,
	top5: answerable.filter(r => r.top5).length,
	candidate_p95_ms: times.sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1],
	limitations: ["Candidate ranking only; no refinement, selection, tasks or rendering."],
	results,
};
await writeFile(arg("--output"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, results: undefined }));
db.close();
global.exec("PRAGMA journal_mode=DELETE; VACUUM");
global.close();
