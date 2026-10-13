import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { terraformHash } from "../src/internal-urls/terraform-documentation";
import { resolveCorpusSources } from "./corpus-sources";
import { fetchTerraformSnapshot } from "./terraform-snapshot-download";
export async function refreshCorpusSources(root = path.join(import.meta.dir, "../../..")) {
	const sources = await resolveCorpusSources();
	if (process.env.EXPECTED_SPEC_TAG && sources.api.tag !== process.env.EXPECTED_SPEC_TAG)
		throw new Error("Latest corpus does not match dispatched spec release");
	if (process.env.EXPECTED_PROVIDER_TAG && sources.provider.tag !== process.env.EXPECTED_PROVIDER_TAG)
		throw new Error("Latest corpus does not match receipt-verified provider release");
	// Resolve immutable releases, verify the published documentation receipt bytes,
	// and let the normal generators verify every archive and rebuild index attestations.
	if (
		sources.provider.acceptance !== "immutable" ||
		sources.terraform.acceptance !== "immutable" ||
		sources.api.acceptance !== "immutable"
	)
		throw new Error("Corpus refresh requires immutable provider, documentation, and API releases");
	const response = await fetchTerraformSnapshot(
		`https://github.com/${sources.terraform.repository}/releases/download/${sources.terraform.tag}/publication.json`,
	);
	if (!response.ok) throw new Error(`Documentation receipt download failed: ${response.status}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	const receipt = JSON.parse(bytes.toString());
	const expected = sources.terraform.assets["publication.json"]!;
	if (bytes.length !== expected.size_bytes || terraformHash(bytes) !== expected.sha256)
		throw new Error("Documentation receipt bytes mismatch");
	if (
		receipt.provider_version !== sources.provider.tag ||
		receipt.source_commit !== sources.terraform.commit ||
		receipt.source_repository !== sources.terraform.repository
	)
		throw new Error("Documentation receipt identity mismatch");
	const old = JSON.parse(await readFile(path.join(root, "tools/terraform-documentation-release.json"), "utf8"));
	const pin = {
		...receipt,
		release_tag: sources.terraform.tag,
		assets: sources.terraform.assets,
		receipt_sha256: expected.sha256,
		retrieval_metadata_version: 1,
	};
	delete pin.index;

	if (
		old.release_tag === pin.release_tag &&
		old.source_commit === pin.source_commit &&
		JSON.stringify(old.assets) === JSON.stringify(pin.assets)
	)
		pin.index = old.index;
	await writeFile(
		path.join(root, "tools/terraform-documentation-release.json"),
		`${JSON.stringify(pin, null, "\t")}\n`,
	);
	await writeFile(path.join(root, "tools/corpus-sources.json"), `${JSON.stringify(sources, null, "\t")}\n`);
	const specPin = {
		version: sources.api.tag.slice(1),
		release_tag: sources.api.tag,
		target_commit: sources.api.commit,
		assets: Object.fromEntries(
			Object.entries(sources.api.assets).map(([name, asset]) => [name, `sha256:${asset.sha256}`]),
		),
	};
	await writeFile(path.join(root, "tools/spec-release.json"), `${JSON.stringify(specPin, null, "\t")}\n`);
	console.log(
		`Refreshed verified corpus identities: ${sources.api.tag}, ${sources.provider.tag}, ${sources.terraform.tag}`,
	);
}
if (import.meta.main) await refreshCorpusSources();
