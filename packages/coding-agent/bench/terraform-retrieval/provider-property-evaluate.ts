// Development-only bounded provider/property candidate experiment.

import { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	terraformHash,
	terraformProviderMention,
	terraformQueryIdentity,
} from "../../src/internal-urls/terraform-documentation";
import { searchPropertyIndex } from "../../src/internal-urls/terraform-property-index";
import { resolveIndexedTask } from "./indexed-task-route";
import { searchProviderDiscovery, validateProviderDiscovery } from "./provider-discovery";
import { validateQualificationEligibility } from "./score";

const args = process.argv.slice(2),
	arg = (k: string) => args[args.indexOf(k) + 1];
const db = new Database(arg("--source"), { readonly: true }),
	providers = new Database(arg("--providers"), { readonly: true });
const pin = JSON.parse((db.query("SELECT pin FROM terraform_provenance").get() as { pin: string }).pin);
validateProviderDiscovery(providers, {
	sourceCommit: pin.source_commit,
	sourceIndexSha256: terraformHash(await readFile(arg("--source"))),
});
const raw = await readFile(arg("--suite"));
const regression = process.argv.includes("--regression");
const eligibilityFile = path.join(path.dirname(arg("--suite")), "eligibility.json");
if (await Bun.file(eligibilityFile).exists())
	validateQualificationEligibility(
		JSON.parse(await readFile(eligibilityFile, "utf8")),
		terraformHash(raw),
		regression,
	);
const parsed = JSON.parse(raw.toString());
const cases = parsed.cases ?? parsed;
const results = [];
const timings: number[] = [];
for (const [i, c] of cases.entries()) {
	let destinations: string[] = [];
	let names: string[] = [];
	const role = terraformQueryIdentity(c.prompt).providerType;
	for (let repetition = 0; repetition < 5; repetition++) {
		const start = performance.now();
		const ownerNames = (
			db
				.query(
					"SELECT DISTINCT provider_name FROM terraform_documents WHERE (? IS NULL OR provider_type=?) ORDER BY provider_name",
				)
				.all(role ?? null, role ?? null) as Array<{ provider_name: string }>
		).map(r => r.provider_name);
		const named = terraformProviderMention(c.prompt, ownerNames);
		const explicit = /\bxcsh_[a-z0-9_]+\b|\b(?:resource|data[ -]source|action)\b/i.test(c.prompt);
		const scope =
			named && explicit
				? [{ provider_type: role, provider_name: named, score: 1, coverage: 1 }]
				: searchProviderDiscovery(providers, c.prompt, { providerType: role }, 5);
		names = scope.map(r => r.provider_name);
		const task = resolveIndexedTask(db, c.prompt, {
			providerType: role,
			providerName: named,
			inferredIdentity: true,
		});
		const candidates = scope.flatMap((provider, p) =>
			searchPropertyIndex(
				db,
				c.prompt,
				{ providerType: provider.provider_type, providerName: provider.provider_name },
				100,
			)
				.slice(0, 5)
				.map((r, n) => ({
					uri: `xcsh://terraform-documentation/${r.path}#${r.anchor}`,
					score: Number((1 / (20 + p) + 1 / (20 + n)).toFixed(12)),
					propertyScore: r.score,
					providerRank: p + 1,
					propertyRank: n + 1,
				})),
		);
		const ranked = candidates.sort(
			(a, b) =>
				b.score - a.score || b.propertyScore - a.propertyScore || (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0),
		);
		destinations = task?.destinations.length
			? task.destinations.map(r => `xcsh://terraform-documentation/${r.path}#${r.anchor}`)
			: [...new Set(ranked.map(r => r.uri))].slice(0, 5);
		timings.push(performance.now() - start);
	}
	results.push({
		id: c.id ?? `development-${i + 1}`,
		kind: c.kind,
		provider_choices: names,
		destinations,
		top1: c.expected.includes(destinations[0]),
		top5: c.expected.some((u: string) => destinations.includes(u)),
	});
}
const answerable = results.filter(r => r.kind === "answerable");
const report = {
	development_only: true,
	post_analysis_regression: regression,
	qualification_passed: false,
	production_imported: false,
	selection_policy: false,
	suite_sha256: terraformHash(raw),
	source_commit: pin.source_commit,
	source_index_sha256: terraformHash(await readFile(arg("--source"))),
	answerable: answerable.length,
	top1: answerable.filter(r => r.top1).length,
	top5: answerable.filter(r => r.top5).length,
	candidate_route_p95_ms: timings.sort((a, b) => a - b)[Math.ceil(timings.length * 0.95) - 1],
	limitations: [
		"Provider BM25 plus reciprocal rank fusion experiment only.",
		"Candidate retrieval excludes confidence selection, response rendering and model time.",
	],
	results,
};
await writeFile(arg("--output"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, results: undefined }));
db.close();
providers.close();
