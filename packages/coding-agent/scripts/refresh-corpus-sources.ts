import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDocumentationReleasePin } from "../src/internal-urls/documentation-snapshot";
import { QMD_VERSION } from "../src/internal-urls/qmd-version";
import { terraformHash } from "../src/internal-urls/terraform-documentation";
import { type CorpusSource, type CorpusSources, resolveCorpusSources } from "./corpus-sources";
import { fetchTerraformSnapshot } from "./terraform-snapshot-download";
import { downloadVerifiedCorpusAsset } from "./verified-corpus-asset";

type Request = (url: string) => Promise<Response>;

async function verifiedJson(source: CorpusSource, name: string, request: Request): Promise<unknown> {
	return JSON.parse(Buffer.from(await downloadVerifiedCorpusAsset(source, name, request)).toString("utf8"));
}

export async function generalSourceRecord(source: CorpusSource, request: Request = fetchTerraformSnapshot) {
	const receipt = (await verifiedJson(source, "publication.json", request)) as {
		schema_version: number;
		source_commit: string;
		release_tag: string;
	};
	if (receipt.schema_version !== 1 || receipt.source_commit !== source.commit || receipt.release_tag !== source.tag)
		throw new Error("General documentation receipt identity mismatch");
	const manifest = (await verifiedJson(source, "manifest.json", request)) as {
		schema_version: number;
		source_roots: Record<string, string>;
		documents: Array<{ path: string; file_sha256: string }>;
		assets: unknown[];
	};
	if (manifest.schema_version !== 2 || !Array.isArray(manifest.documents) || !Array.isArray(manifest.assets))
		throw new Error("General documentation manifest is invalid");
	const textManifest = manifest.documents
		.map(document => {
			if (typeof document.path !== "string" || !/^[a-f0-9]{64}$/.test(document.file_sha256))
				throw new Error("General documentation manifest document is invalid");
			return `${document.path}\0${document.file_sha256}\n`;
		})
		.sort()
		.join("");
	return parseDocumentationReleasePin({
		schema_version: 2,
		source_repository: source.repository,
		release_tag: source.tag,
		source_commit: source.commit,
		receipt_sha256: source.assets["publication.json"]!.sha256,
		assets: source.assets,
		manifest: {
			schema_version: 2,
			document_count: manifest.documents.length,
			asset_count: manifest.assets.length,
			source_roots: Object.keys(manifest.source_roots).sort(),
		},
		index: { qmd_version: QMD_VERSION, fingerprint: "pending", sha256: "pending", size_bytes: 0 },
		packaging: {
			mode: "text-only-sqlite",
			text_manifest_sha256: terraformHash(textManifest),
			source_media_count: manifest.assets.length,
			bundled_media_count: 0,
		},
	});
}

export async function refreshCorpusSources(
	root = path.join(import.meta.dir, "../../.."),
	resolve: () => Promise<CorpusSources> = resolveCorpusSources,
	request: Request = fetchTerraformSnapshot,
) {
	const sources = await resolve();
	const general = await generalSourceRecord(sources.general, request);
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
	const response = await request(
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
	await writeFile(path.join(root, "tools/documentation-release.json"), `${JSON.stringify(general, null, "\t")}\n`);

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
