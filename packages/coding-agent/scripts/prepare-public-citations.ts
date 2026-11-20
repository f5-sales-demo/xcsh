import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type CorpusSources, requireFreshCorpusSources } from "./corpus-sources";
import { fetchTerraformSnapshot } from "./terraform-snapshot-download";
import { type AssetRequest, downloadVerifiedCorpusAsset } from "./verified-corpus-asset";

export interface PublicCitationPreparation {
	resolve?: () => Promise<CorpusSources>;
	request?: AssetRequest;
	run?: (evidenceRoot: string) => Promise<void>;
}

async function downloadSitemap(url: string, request: AssetRequest): Promise<Uint8Array> {
	const response = await request(url);
	if (!response.ok || !response.body) throw new Error(`Public sitemap download failed: HTTP ${response.status}`);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			length += next.value.byteLength;
			if (length > 10 * 1024 * 1024) throw new Error("Public sitemap exceeds bounded size");
			chunks.push(next.value);
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function runGenerator(evidenceRoot: string): Promise<void> {
	const child = Bun.spawn(
		[
			"python3",
			path.join(import.meta.dir, "generate_public_citation_destinations.py"),
			"--evidence-root",
			evidenceRoot,
		],
		{
			cwd: path.resolve(import.meta.dir, ".."),
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	const code = await child.exited;
	if (code !== 0) throw new Error(`Verified public citation generation failed (${code})`);
}

export async function preparePublicCitations(options: PublicCitationPreparation = {}): Promise<void> {
	const sources = await (options.resolve ?? requireFreshCorpusSources)();
	const request = options.request ?? fetchTerraformSnapshot;
	const root = await mkdtemp(path.join(tmpdir(), "xcsh-public-citations-"));
	await chmod(root, 0o700);
	try {
		await mkdir(path.join(root, "assessment"));
		await writeFile(
			path.join(root, "assessment/source-receipts.json"),
			JSON.stringify({
				content: sources.general,
				provider: sources.terraform,
				api: sources.api,
			}),
			{ mode: 0o600 },
		);
		for (const [name, source, assets] of [
			["content", sources.general, ["manifest.json"]],
			["provider", sources.terraform, ["manifest.json"]],
			["api", sources.api, ["api-catalog.json", `f5xc-api-specs-${sources.api.tag}.zip`]],
		] as const) {
			const directory = path.join(root, "sources", name);
			await mkdir(directory, { recursive: true });
			for (const asset of assets)
				await writeFile(path.join(directory, asset), await downloadVerifiedCorpusAsset(source, asset, request), {
					mode: 0o600,
				});
		}
		for (const [name, website] of [
			["provider", "terraform-provider-xcsh"],
			["api", "api-specs-enriched"],
		] as const)
			await writeFile(
				path.join(root, "sources", name, "sitemap-0.xml"),
				await downloadSitemap(`https://f5-sales-demo.github.io/${website}/sitemap-0.xml`, request),
				{ mode: 0o600 },
			);
		await (options.run ?? runGenerator)(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

if (import.meta.main) await preparePublicCitations();
