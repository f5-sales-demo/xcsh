import { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { terraformHash, terraformQueryIdentity } from "../../src/internal-urls/terraform-documentation";
import {
	buildProviderDiscovery,
	type ProviderRecord,
	searchProviderDiscovery,
	validateProviderDiscovery,
} from "./provider-discovery";

const args = process.argv.slice(2),
	arg = (k: string) => args[args.indexOf(k) + 1];
const source = new Database(arg("--source"), { readonly: true });
const index = new Database(arg("--index"), { create: true });
const raw = await readFile(arg("--suite"));
const suite = JSON.parse(raw.toString());
const cases = suite.cases ?? suite;
const start = performance.now();
const pin = JSON.parse((source.query("SELECT pin FROM terraform_provenance").get() as { pin: string }).pin);
const binding = { sourceCommit: pin.source_commit, sourceIndexSha256: terraformHash(await readFile(arg("--source"))) };
const rows = source
	.query("SELECT path,metadata FROM terraform_documents WHERE role IN (?,?) ORDER BY provider_type,provider_name,path")
	.all("fundamentals", "overview") as Array<{ path: string; metadata: string }>;
const records: ProviderRecord[] = rows.map(r => {
	const m = JSON.parse(r.metadata);
	return {
		path: r.path,
		provider_type: m.provider_type,
		provider_name: m.provider_name,
		summary: m.summary,
		aliases: m.aliases,
		facets: [
			...(m.capabilities ?? []).map((v: string) => ({ key: "capability", value: v })),
			...(m.tasks ?? []).map((v: string) => ({ key: "task", value: v })),
			...(m.category ? [{ key: "category", value: m.category }] : []),
		],
	};
});
if (!index.query("SELECT 1 FROM sqlite_master WHERE name=?").get("provider_search"))
	buildProviderDiscovery(index, records, binding);
validateProviderDiscovery(index, binding);
const buildMs = performance.now() - start;
const times: number[] = [];
const results = [];
for (const [n, item] of cases.entries()) {
	const providerType = terraformQueryIdentity(item.prompt).providerType;
	let ranked: ReturnType<typeof searchProviderDiscovery> = [];
	for (let i = 0; i < 5; i++) {
		const before = performance.now();
		ranked = searchProviderDiscovery(index, item.prompt, { providerType }, 5);
		times.push(performance.now() - before);
	}
	const expected = item.expected.map((uri: string) => {
		const m = source
			.query("SELECT provider_type,provider_name FROM terraform_documents WHERE path=?")
			.get(new URL(uri).pathname.slice(1)) as any;
		return m ? `${m.provider_type}:${m.provider_name}` : "";
	});
	results.push({
		id: item.id ?? `development-${n + 1}`,
		kind: item.kind,
		providerType,
		expected_provider: expected,
		top1: expected.includes(`${ranked[0]?.provider_type}:${ranked[0]?.provider_name}`),
		top5: ranked.some(r => expected.includes(`${r.provider_type}:${r.provider_name}`)),
		ranked,
	});
}
const answerable = results.filter(r => r.kind === "answerable");
const report = {
	development_only: true,
	qualification_passed: false,
	production_imported: false,
	suite_sha256: terraformHash(raw),
	source_commit: pin.source_commit,
	source_index_sha256: binding.sourceIndexSha256,
	records: records.length,
	distinct_identities: (index.query("SELECT COUNT(*) count FROM provider_search").get() as { count: number }).count,
	build_ms: buildMs,
	provider_top1: answerable.filter(r => r.top1).length,
	provider_top5: answerable.filter(r => r.top5).length,
	answerable: answerable.length,
	warm_p95_ms: times.sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1],
	results,
};
await writeFile(arg("--output"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, results: undefined }));
source.close();
index.exec("PRAGMA journal_mode=DELETE; VACUUM");
index.close();
