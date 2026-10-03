import { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	terraformHash,
	terraformProviderMention,
	terraformQueryIdentity,
} from "../../src/internal-urls/terraform-documentation";
import { searchPropertyIndex } from "../../src/internal-urls/terraform-property-index";
import { validateQualificationEligibility } from "./score";

const args = process.argv.slice(2),
	arg = (k: string) => args[args.indexOf(k) + 1];
const source = new Database(arg("--source"), { readonly: true });
const raw = await readFile(arg("--suite")),
	parsed = JSON.parse(raw.toString());
const eligibility = path.join(path.dirname(arg("--suite")), "eligibility.json");
if (await Bun.file(eligibility).exists())
	validateQualificationEligibility(
		JSON.parse(await readFile(eligibility, "utf8")),
		terraformHash(raw),
		args.includes("--regression"),
	);
const results = [];
for (const [i, c] of (parsed.cases ?? parsed).entries()) {
	const before = performance.now();
	const role = terraformQueryIdentity(c.prompt).providerType;
	const names = (
		source
			.query(
				"SELECT DISTINCT provider_name FROM terraform_documents WHERE (? IS NULL OR provider_type=?) ORDER BY provider_name",
			)
			.all(role ?? null, role ?? null) as Array<{ provider_name: string }>
	).map(r => r.provider_name);
	const provider = terraformProviderMention(c.prompt, names);
	const rows = searchPropertyIndex(source, c.prompt, { providerType: role, providerName: provider }, 500);
	results.push({
		id: c.id ?? `development-${i + 1}`,
		prompt: c.prompt,
		kind: c.kind,
		expected: c.expected,
		role,
		provider,
		lexical_ms: performance.now() - before,
		destinations: rows.slice(0, 100).map(r => `xcsh://terraform-documentation/${r.path}#${r.anchor}`),
	});
}
await writeFile(
	arg("--output"),
	JSON.stringify(
		{
			development_only: true,
			qualification_passed: false,
			suite_sha256: terraformHash(raw),
			source_index_sha256: terraformHash(await readFile(arg("--source"))),
			cases: results,
		},
		null,
		2,
	) + "\n",
);
source.close();
