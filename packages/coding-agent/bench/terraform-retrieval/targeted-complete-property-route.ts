import { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import {
	boundedTerraformResponse,
	rankTerraformDirectProperties,
	rankTerraformProviderNames,
	rewriteTerraformLinks,
	terraformHash,
	terraformProviderMention,
	terraformQueryIdentity,
	terraformTimeoutOperations,
} from "../../src/internal-urls/terraform-documentation";
import type { PropertyCandidate } from "./contrastive-ranking";
import { resolveIndexedTask } from "./indexed-task-route";
import { searchPropertyIndex, validatePropertyIndex } from "./property-index";
import { type RankedProperty, selectPropertyDestination } from "./property-selection";

const args = process.argv.slice(2);
const arg = (key: string) => {
	const index = args.indexOf(key);
	return index < 0 ? undefined : args[index + 1];
};
const propertyIndex = arg("--property-index");
if (!propertyIndex) throw new Error("--property-index required");
const search = new Database(propertyIndex, { readonly: true });
const index = arg("--index"),
	suitePath = arg("--suite"),
	output = arg("--output");
if (!index || !suitePath || !output) throw new Error("--index, --suite and --output required");
const start = performance.now();
const db = new Database(index, { readonly: true });
const preparationMs = performance.now() - start;
const pin = JSON.parse((db.query("SELECT pin FROM terraform_provenance").get() as { pin: string }).pin);
validatePropertyIndex(search, {
	sourceCommit: pin.source_commit,
	sourceIndexSha256: terraformHash(await readFile(index)),
});
const suiteBytes = await readFile(suitePath);
const suite = JSON.parse(suiteBytes.toString());
const cases = (suite.cases ?? suite).map((item: any, index: number) => ({
	...item,
	id: item.id ?? `development-${index + 1}`,
}));
const results = [];
const timings: number[] = [];
for (const item of cases) {
	let role: string | undefined, provider: string | undefined;
	let ranked: ReturnType<typeof searchPropertyIndex> = [];
	const times = [];
	let decision: ReturnType<typeof selectPropertyDestination> = { kind: "none", destinations: [], reason: "No query" };
	let discovery = "",
		context = "",
		responseHash = "";
	for (let n = 0; n < 5; n++) {
		const before = performance.now();
		role = terraformQueryIdentity(item.prompt).providerType;
		const names = (
			db
				.query(
					"SELECT DISTINCT provider_name FROM terraform_documents WHERE (? IS NULL OR provider_type=?) ORDER BY provider_name",
				)
				.all(role ?? null, role ?? null) as { provider_name: string }[]
		).map(row => row.provider_name);
		provider = terraformProviderMention(item.prompt, names);
		if (!provider && role === "actions") {
			const matches = rankTerraformProviderNames(item.prompt, names);
			if (matches[0] && (!matches[1] || matches[0].score >= matches[1].score + 10)) provider = matches[0].name;
		}

		const task = resolveIndexedTask(db, item.prompt, {
			providerType: role,
			providerName: provider,
			inferredIdentity: true,
		});
		if (task) {
			decision = task;
			ranked = task.destinations;
		} else {
			ranked = searchPropertyIndex(search, item.prompt, { providerType: role, providerName: provider });
			const top = ranked[0];
			if (top?.anchor === "section") {
				const record = db.query("SELECT metadata FROM terraform_documents WHERE path=?").get(top.path) as {
					metadata: string;
				};
				const m = JSON.parse(record.metadata);
				const refined = rankTerraformDirectProperties(item.prompt, m.schema_path, m.sections ?? []);
				if (refined[0]?.document_id === m.id) {
					const field = db
						.query(
							"SELECT provider_type,provider_name,schema_path,path,anchor,description FROM terraform_destinations WHERE path=? AND anchor=?",
						)
						.get(top.path, refined[0].anchor) as PropertyCandidate | null;
					if (field) ranked = [{ ...field, score: top.score, coverage: top.coverage }, ...ranked.slice(1)];
				}
			}
			const operations = terraformTimeoutOperations(item.prompt);
			if (provider && operations.length) {
				const paths = operations.map(operation => `timeouts.${operation}`);
				const fields = db
					.query(
						`SELECT provider_type,provider_name,schema_path,path,anchor,description FROM terraform_destinations WHERE provider_name=? AND (? IS NULL OR provider_type=?) AND schema_path IN (${paths.map(() => "?").join(",")}) ORDER BY provider_type,schema_path`,
					)
					.all(provider, role ?? null, role ?? null, ...paths) as PropertyCandidate[];
				if (fields.length) ranked = fields.map(row => ({ ...row, score: 100, coverage: 1 }));
			}
			const first = ranked[0];
			const leaf = first?.schema_path.split(".").at(-1);
			const alternatives = first
				? (db
						.query(
							"SELECT provider_type,provider_name,schema_path,path,anchor,description FROM terraform_destinations WHERE provider_name=? AND (? IS NULL OR provider_type=?) AND (schema_path=? OR substr(schema_path,-length(?))=?) ORDER BY provider_type,schema_path",
						)
						.all(first.provider_name, role ?? null, role ?? null, leaf ?? null, `.${leaf}`, `.${leaf}`)
						.map((row: any) => ({ ...row, score: 0, coverage: 0 })) as RankedProperty[])
				: [];
			decision = selectPropertyDestination(item.prompt, ranked.slice(0, 5), alternatives);
		}
		const provenance = `Provider: ${pin.provider_version}\nSnapshot: ${pin.release_tag}\nCommit: ${pin.source_commit}\nReceipt SHA-256: ${pin.receipt_sha256}`;
		discovery = boundedTerraformResponse(
			`${provenance}\nSelection: ${decision.kind}\nReason: ${decision.reason}`,
			decision.destinations.map(
				row => `Read: xcsh://terraform-documentation/${row.path}?view=context#${row.anchor}\n${row.description}`,
			),
			4096,
		);
		context = "";
		if (decision.kind === "leaf") {
			const row = decision.destinations[0]!;
			const section = db
				.query("SELECT context_markdown FROM terraform_sections WHERE path=? AND anchor=?")
				.get(row.path, row.anchor) as { context_markdown: string } | null;
			if (!section) throw new Error("Missing selected section");
			const full = `${provenance}\nRead: xcsh://terraform-documentation/${row.path}?view=full#${row.anchor}\n${rewriteTerraformLinks(section.context_markdown, row.path)}`;
			context =
				Buffer.byteLength(full) <= 16384
					? full
					: `${provenance}\nOversized section; complete read: xcsh://terraform-documentation/${row.path}?view=full#${row.anchor}`;
		}
		if (Buffer.byteLength(discovery) > 4096 || Buffer.byteLength(context) > 16384)
			throw new Error("Response budget exceeded");
		const hash = terraformHash(discovery + "\0" + context);
		if (n === 0) responseHash = hash;
		else if (hash !== responseHash) throw new Error("Non-deterministic complete response");
		times.push(performance.now() - before);
	}
	timings.push(...times);

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
		selection: decision.kind,
		reason: decision.reason,
		selected_destinations: decision.destinations.map(
			row => `xcsh://terraform-documentation/${row.path}#${row.anchor}`,
		),
		correct_leaf:
			item.kind === "answerable" &&
			decision.kind === "leaf" &&
			`xcsh://terraform-documentation/${decision.destinations[0]!.path}#${decision.destinations[0]!.anchor}` ===
				item.expected[0],
		false_leaf:
			item.kind === "answerable" &&
			decision.kind === "leaf" &&
			`xcsh://terraform-documentation/${decision.destinations[0]!.path}#${decision.destinations[0]!.anchor}` !==
				item.expected[0],
		discovery_bytes: Buffer.byteLength(discovery),
		context_bytes: Buffer.byteLength(context),
		discovery_sha256: terraformHash(discovery),
		context_sha256: terraformHash(context),
		times_ms: times,
	});
}
const propertyIds = new Set(
	cases
		.filter((item: any) => item.kind === "answerable" && item.expected[0]?.includes("/properties/"))
		.map((item: any) => item.id),
);
const properties = results.filter(row => propertyIds.has(row.id));

const report = {
	development_only: true,
	qualification_passed: false,
	production_promoted: false,
	suite_sha256: terraformHash(suiteBytes),
	source_commit: pin.source_commit,
	provider_version: pin.provider_version,
	answerable_cases: results.filter(row => row.kind === "answerable").length,
	answerable_correct_leaf: results.filter(row => row.kind === "answerable" && row.correct_leaf).length,
	answerable_false_leaf: results.filter(row => row.kind === "answerable" && row.false_leaf).length,
	property_cases: properties.length,
	correct_leaf: properties.filter(row => row.correct_leaf).length,
	false_leaf: properties.filter(row => row.false_leaf).length,
	clarifications: properties.filter(row => row.selection === "choices").length,
	property_first: properties.filter(row => row.first).length,
	property_top5: properties.filter(row => row.top5).length,
	preparation_ms: preparationMs,

	experimental_complete_route_p95_ms: timings.sort((a, b) => a - b)[Math.ceil(timings.length * 0.95) - 1],
	limitations: [
		"Measured route includes candidate query, provider/task identity, ranking, refinement, lifecycle routing, indexed collisions, selection and bounded discovery/context rendering. Model and network time excluded.",
		"Development labels have known defects and unresolved same-role ambiguities.",
		"Experimental route uses prepared terms and scope weights via targeted indexed SQL, with exact source reads. Bundled index integration, cold materialization and installed acceptance remain unverified.",
	],
	results,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, results: undefined }));
search.close();
db.close();
