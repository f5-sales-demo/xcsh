import { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { terraformHash } from "../../src/internal-urls/terraform-documentation";
import type { PropertyCandidate } from "../../src/internal-urls/terraform-property-ranking";
import { sourceCollisionAlternatives } from "./source-collision-audit";
const arg = (name: string) => {
	const i = process.argv.indexOf(name);
	return i < 0 ? undefined : process.argv[i + 1];
};
const index = arg("--index"),
	suite = arg("--suite"),
	output = arg("--output");
if (!index || !suite || !output) throw Error("--index --suite --output required");
const bytes = await readFile(suite);
const cases = JSON.parse(bytes.toString());
const db = new Database(index, { readonly: true });
const source = db
	.query(
		"SELECT provider_type,provider_name,schema_path,path,anchor,description FROM terraform_destinations ORDER BY provider_type,provider_name,schema_path",
	)
	.all() as PropertyCandidate[];
const destinations = new Map(source.map(row => [`${row.path}#${row.anchor}`, row]));
const findings = [];
for (const item of cases) {
	if (item.kind !== "answerable") continue;
	for (const expected of item.expected) {
		const u = new URL(expected);
		const key = `${u.pathname.slice(1)}#${decodeURIComponent(u.hash.slice(1))}`;
		const row = destinations.get(key);
		if (!row) continue;
		const alternatives = sourceCollisionAlternatives(row, source);
		if (alternatives.length > 1)
			findings.push({
				id: item.id,
				expected,
				independent_context_review_required: true,
				alternatives: alternatives.map(row => ({
					provider_type: row.provider_type,
					schema_path: row.schema_path,
					destination: `xcsh://terraform-documentation/${row.path}#${row.anchor}`,
				})),
			});
	}
}
const report = {
	source_only: true,
	qualification_passed: false,
	suite_sha256: terraformHash(bytes),
	index_sha256: terraformHash(await readFile(index)),
	answerable_cases: cases.filter((c: any) => c.kind === "answerable").length,
	potential_collision_cases: findings.length,
	findings,
	limitations: [
		"An alternative is not a label defect when the prompt supplies verified distinguishing context. Independent source review must adjudicate every listed case.",
	],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
db.close();
console.log(JSON.stringify({ ...report, findings: undefined }));
