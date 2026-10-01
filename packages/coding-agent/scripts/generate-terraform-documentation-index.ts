#!/usr/bin/env bun
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
	buildTerraformIndex,
	parseTerraformPin,
	TERRAFORM_ASSETS,
	terraformHash,
	verifyTerraformSnapshot,
} from "../src/internal-urls/terraform-documentation";

const root = path.join(import.meta.dir, "../../..");
const generated = path.join(import.meta.dir, "../src/internal-urls/.documentation-generated/terraform");
const loader = path.join(import.meta.dir, "../src/internal-urls/terraform-documentation-assets.generated.ts");
const pinPath = path.join(root, "tools/terraform-documentation-release.json");
const placeholder =
	'import type { TerraformEmbeddedAssets } from "./terraform-documentation";\nexport const EMBEDDED_TERRAFORM_DOCUMENTATION: TerraformEmbeddedAssets | null = null;\n';

async function main(): Promise<void> {
	if (process.argv.includes("--reset")) {
		await rm(generated, { recursive: true, force: true });
		await writeFile(loader, placeholder);
		return;
	}
	const pin = parseTerraformPin(JSON.parse(await readFile(pinPath, "utf8")));
	await mkdir(generated, { recursive: true });
	const inputIndex = process.argv.indexOf("--input-dir");
	const input = inputIndex < 0 ? generated : process.argv[inputIndex + 1]!;
	if (inputIndex < 0 && !process.argv.includes("--use-existing")) {
		const identityResponse = await fetch(
			`https://api.github.com/repos/${pin.source_repository}/releases/tags/${pin.release_tag}`,
			{ headers: { Accept: "application/vnd.github+json" } },
		);
		if (!identityResponse.ok) throw new Error("Terraform release identity lookup failed");
		const release = (await identityResponse.json()) as {
			tag_name: string;
			draft: boolean;
			prerelease: boolean;
			immutable: boolean;
			assets: Array<{ name: string; size: number; digest: string }>;
		};
		if (release.tag_name !== pin.release_tag || release.draft || release.prerelease || !release.immutable)
			throw new Error("Terraform release must be published and immutable");
		if (
			release.assets
				.map(a => a.name)
				.sort()
				.join() !== [...TERRAFORM_ASSETS].sort().join()
		)
			throw new Error("Terraform release asset membership mismatch");
		for (const asset of release.assets)
			if (
				asset.size !== pin.assets[asset.name]!.size_bytes ||
				asset.digest !== `sha256:${pin.assets[asset.name]!.sha256}`
			)
				throw new Error("Terraform GitHub asset provenance mismatch");
		for (const name of TERRAFORM_ASSETS) {
			const response = await fetch(
				`https://github.com/${pin.source_repository}/releases/download/${pin.release_tag}/${name}`,
			);
			if (!response.ok) throw new Error(`Terraform snapshot download failed: ${name}: ${response.status}`);
			await Bun.write(path.join(input, name), response);
		}
	}
	const output = path.join(generated, "terraform-documentation.sqlite");
	const gzipPath = `${output}.gz`;
	if (!process.argv.includes("--use-existing")) {
		const documents = await verifyTerraformSnapshot(input, pin);
		await buildTerraformIndex(documents, pin, output);
		const bytes = await readFile(output);
		const compressed = gzipSync(bytes, { level: 9 });
		compressed[9] = 255;
		const index = {
			sha256: terraformHash(bytes),
			size_bytes: bytes.length,
			gzip_sha256: terraformHash(compressed),
			gzip_size_bytes: compressed.length,
		};
		if (process.argv.includes("--update-pin")) {
			pin.index = index;
			await writeFile(pinPath, `${JSON.stringify(pin, null, "\t")}\n`);
		} else if (JSON.stringify(index) !== JSON.stringify(pin.index))
			throw new Error("Terraform generated index differs from reviewed pin");
		await writeFile(gzipPath, compressed);
	}
	const compressed = await readFile(gzipPath);
	if (
		!pin.index ||
		compressed.length !== pin.index.gzip_size_bytes ||
		terraformHash(compressed) !== pin.index.gzip_sha256
	)
		throw new Error("Terraform prebuilt index verification failed");
	const bytes = gunzipSync(compressed, { maxOutputLength: pin.index.size_bytes });
	if (bytes.length !== pin.index.size_bytes || terraformHash(bytes) !== pin.index.sha256)
		throw new Error("Terraform prebuilt SQLite verification failed");
	await writeFile(
		loader,
		`import indexGzipPath from "./.documentation-generated/terraform/terraform-documentation.sqlite.gz" with { type: "file" };\nimport type { TerraformEmbeddedAssets } from "./terraform-documentation";\nexport const EMBEDDED_TERRAFORM_DOCUMENTATION = { indexGzipPath, pin: ${JSON.stringify(pin)} } satisfies TerraformEmbeddedAssets;\n`,
	);
	console.log(JSON.stringify({ providerVersion: pin.provider_version, ...pin.index }));
}

await main();
