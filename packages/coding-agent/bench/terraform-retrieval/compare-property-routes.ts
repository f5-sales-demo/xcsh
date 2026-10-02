import { readFile, writeFile } from "node:fs/promises";
import {
	TerraformDocumentationRepository,
	type TerraformEmbeddedAssets,
} from "../../src/internal-urls/terraform-documentation";
import type { InternalUrl } from "../../src/internal-urls/types";
const args = process.argv.slice(2);
const arg = (key: string) => {
	const index = args.indexOf(key);
	return index < 0 ? undefined : args[index + 1];
};
const suitePath = arg("--suite"),
	rankingPath = arg("--ranking"),
	assetPath = arg("--assets"),
	output = arg("--output");
if (!suitePath || !rankingPath || !assetPath || !output)
	throw new Error("--suite, --ranking, --assets and --output required");
const payload = JSON.parse(await readFile(suitePath, "utf8"));
const cases = (payload.cases ?? payload).map((item: any, index: number) => ({
	...item,
	id: item.id ?? `development-${index + 1}`,
}));
const ranking = JSON.parse(await readFile(rankingPath, "utf8"));
const byId = new Map(ranking.results.map((row: any) => [row.id, row]));
const assets = JSON.parse(await readFile(assetPath, "utf8")) as TerraformEmbeddedAssets;
const repo = new TerraformDocumentationRepository(assets, `${output}.cache`);
await repo.database();
const results = [];
for (const item of cases) {
	const uri = new URL(`xcsh://terraform-documentation/?search=${encodeURIComponent(item.prompt)}`);
	const content = (await repo.resolve(Object.assign(uri, { rawHost: "terraform-documentation" }) as InternalUrl))
		.content;
	const destinations = [...content.matchAll(/^Read: (\S+)/gm)].map(match => {
		const u = new URL(match[1]!);
		u.search = "";
		return u.href;
	});
	const alternate = byId.get(item.id) as any;
	const selected = content.includes("Selected leaf;");
	results.push({
		id: item.id,
		kind: item.kind,
		production_selected: selected,
		production_first: destinations[0] === item.expected[0],
		production_destinations: destinations,
		ranking_first: alternate?.first ?? false,
		ranking_destinations: alternate?.destinations ?? [],
		union_top5: item.expected.some((uri: string) =>
			[...destinations, ...(alternate?.destinations ?? [])].includes(uri),
		),
		first_union: destinations[0] === item.expected[0] || alternate?.first,
	});
}
const properties = results.filter(
	row =>
		row.kind === "answerable" && cases.find((item: any) => item.id === row.id).expected[0]?.includes("/properties/"),
);
const report = {
	development_only: true,
	qualification_passed: false,
	production_promoted: false,
	provider_version: assets.pin.provider_version,
	source_commit: assets.pin.source_commit,
	property_cases: properties.length,
	production_first: properties.filter(row => row.production_first).length,
	ranking_first: properties.filter(row => row.ranking_first).length,
	first_union_ceiling: properties.filter(row => row.first_union).length,
	top5_union_ceiling: properties.filter(row => row.union_top5).length,
	limitations: [
		"Union ceilings use expected labels for diagnostics and are not an executable selection policy.",
		"No confidence or installed qualification.",
	],
	results,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, results: undefined }));
(await repo.database()).close();
