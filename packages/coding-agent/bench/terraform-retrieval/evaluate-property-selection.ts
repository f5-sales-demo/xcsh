import { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { selectPropertyDestination, type RankedProperty } from "./property-selection";
import { boundedTerraformResponse, terraformHash } from "../../src/internal-urls/terraform-documentation";
const args = process.argv.slice(2);
const arg = (key: string) => {
	const i = args.indexOf(key);
	return i < 0 ? undefined : args[i + 1];
};
const rankingPath = arg("--ranking"),
	suitePath = arg("--suite"),
	index = arg("--index"),
	output = arg("--output");
if (!rankingPath || !suitePath || !index || !output) throw new Error("--ranking, --suite, --index, --output required");
const ranking = JSON.parse(await readFile(rankingPath, "utf8"));
const bytes = await readFile(suitePath);
const payload = JSON.parse(bytes.toString());
const cases = (payload.cases ?? payload).map((c: any, i: number) => ({ ...c, id: c.id ?? `development-${i + 1}` }));
const byId = new Map(cases.map((c: any) => [c.id, c]));
const db = new Database(index, { readonly: true });
const pin = JSON.parse((db.query("SELECT pin FROM terraform_provenance").get() as { pin: string }).pin);
const results = [];
const times: number[] = [];
for (const r of ranking.results) {
	const c = byId.get(r.id) as any;
	const candidates = r.ranked as RankedProperty[];
	const first = candidates[0];
	const leaf = first?.schema_path.split(".").at(-1);
	const alternatives = first
		? (db
				.query(
					"SELECT provider_type,provider_name,schema_path,path,anchor,description FROM terraform_destinations WHERE provider_name=? AND (? IS NULL OR provider_type=?) AND (schema_path=? OR substr(schema_path,-length(?))=?) ORDER BY provider_type,schema_path",
				)
				.all(first.provider_name, r.role ?? null, r.role ?? null, leaf, `.${leaf}`, `.${leaf}`)
				.map((row: any) => ({ ...row, score: 0, coverage: 0 })) as RankedProperty[])
		: [];
	let response = "";
	let selected: ReturnType<typeof selectPropertyDestination>;
	for (let n = 0; n < 5; n++) {
		const start = performance.now();
		selected = selectPropertyDestination(c.prompt, candidates, alternatives);
		const uri = (row: RankedProperty) => `xcsh://terraform-documentation/${row.path}?view=context#${row.anchor}`;
		response = boundedTerraformResponse(
			`Provider: ${pin.provider_version}\nCommit: ${pin.source_commit}\nSelection: ${selected.kind}\nReason: ${selected.reason}`,
			selected.destinations.map(row => `Read: ${uri(row)}\n${row.description}`),
			4096,
		);
		if (selected.kind === "leaf") {
			const row = selected.destinations[0]!;
			const section = db
				.query("SELECT context_markdown FROM terraform_sections WHERE path=? AND anchor=?")
				.get(row.path, row.anchor) as { context_markdown: string } | null;
			if (!section) throw new Error("Missing selected section");
			const full = `Provider: ${pin.provider_version}\nCommit: ${pin.source_commit}\n${section.context_markdown}`;
			response +=
				"\n" +
				(Buffer.byteLength(full) > 16384
					? `Oversized section; full read: xcsh://terraform-documentation/${row.path}?view=full#${row.anchor}`
					: full);
		}
		times.push(performance.now() - start + (r.times_ms?.[n] ?? 0));
	}
	const decision = selectPropertyDestination(c.prompt, candidates, alternatives);
	const destinations = decision.destinations.map(row => `xcsh://terraform-documentation/${row.path}#${row.anchor}`);
	results.push({
		id: r.id,
		kind: c.kind,
		selection: decision.kind,
		reason: decision.reason,
		destinations,
		correct_leaf: c.kind === "answerable" && decision.kind === "leaf" && destinations[0] === c.expected[0],
		false_leaf: c.kind === "answerable" && decision.kind === "leaf" && destinations[0] !== c.expected[0],
		complete_choices:
			c.kind === "ambiguous" &&
			decision.kind === "choices" &&
			c.expected.every((uri: string) => destinations.includes(uri)),
		response_bytes: Buffer.byteLength(response),
	});
}
const properties = results.filter(
	row => row.kind === "answerable" && (byId.get(row.id) as any).expected[0]?.includes("/properties/"),
);
const report = {
	development_only: true,
	qualification_passed: false,
	production_promoted: false,
	suite_sha256: terraformHash(bytes),
	property_cases: properties.length,
	correct_leaf: properties.filter(row => row.correct_leaf).length,
	false_leaf: properties.filter(row => row.false_leaf).length,
	clarifications: properties.filter(row => row.selection === "choices").length,
	estimated_rendered_route_p95_ms: times.sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1],
	limitations: [
		"Estimated rendering route adds precomputed ranking measurements; indexed collision lookup is outside this measurement and integrated tool latency remains unverified.",
		"Repeated leaf destinations are validated against the indexed provider scope; task and role inference remains experimental.",
		"Development labels are defective and cannot qualify release.",
	],
	results,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, results: undefined }));
db.close();
