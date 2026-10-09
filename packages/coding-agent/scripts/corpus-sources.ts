import { readFile } from "node:fs/promises";
import path from "node:path";

export interface CorpusSource {
	enrichment?: CorpusSource;
	repository: string;
	tag: string;
	commit: string;
	acceptance: "immutable" | "verified-bytes-mutable";
	assets: Record<string, { sha256: string; size_bytes: number }>;
}
export interface CorpusSources {
	general: CorpusSource;
	terraform: CorpusSource;
	provider: CorpusSource;
	api: CorpusSource;
}
interface Release {
	tag_name: string;
	draft: boolean;
	prerelease: boolean;
	immutable: boolean;
	assets: Array<{ name: string; size: number; digest: string }>;
}
type Fetch = (url: string, options?: RequestInit) => Promise<Response>;
const repositories = {
	general: "f5-sales-demo/html-to-markdown",
	provider: "f5-sales-demo/terraform-provider-xcsh",
	api: "f5-sales-demo/api-specs-enriched",
};
const stable = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function compareVersions(a: Release, b: Release): number {
	const left = a.tag_name.slice(1).split(".").map(Number);
	const right = b.tag_name.slice(1).split(".").map(Number);
	for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
	return 0;
}
export async function resolveCorpusSources(request: Fetch = fetch): Promise<CorpusSources> {
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
	if (token) headers.Authorization = `Bearer ${token}`;
	async function json(url: string): Promise<unknown> {
		const response = await request(url, { headers });
		if (!response.ok) throw new Error(`corpus discovery failed: ${url}: HTTP ${response.status}`);
		return response.json();
	}
	async function inventory(repository: string): Promise<Release[]> {
		const releases: Release[] = [];
		for (let page = 1; page <= 100; page++) {
			const rows = await json(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`);
			if (!Array.isArray(rows)) throw new Error("corpus discovery returned an invalid inventory");
			for (const row of rows) {
				if (
					!row ||
					typeof row.tag_name !== "string" ||
					typeof row.draft !== "boolean" ||
					typeof row.prerelease !== "boolean"
				)
					throw new Error("corpus discovery returned an invalid release");
				if (!row.draft && !row.prerelease) releases.push(row as Release);
			}
			if (rows.length < 100) return releases;
		}
		throw new Error("corpus discovery pagination exceeded limit");
	}
	async function source(repository: string, release: Release | undefined): Promise<CorpusSource> {
		if (!release) throw new Error(`corpus discovery found no eligible release: ${repository}`);
		const assets: CorpusSource["assets"] = {};
		if (!Array.isArray(release.assets) || !release.assets.length) throw new Error("corpus discovery has no assets");
		for (const asset of release.assets) {
			if (
				!/^[A-Za-z0-9_.-]+$/.test(asset.name) ||
				Object.hasOwn(assets, asset.name) ||
				["__proto__", "constructor", "prototype", ".", ".."].includes(asset.name) ||
				!Number.isSafeInteger(asset.size) ||
				asset.size < 0 ||
				!/^sha256:[a-f0-9]{64}$/.test(asset.digest)
			)
				throw new Error("corpus discovery has invalid or duplicate asset identity");
			assets[asset.name] = { sha256: asset.digest.slice(7), size_bytes: asset.size };
		}
		const commit = (await json(
			`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(release.tag_name)}`,
		)) as { sha?: string };
		if (!commit.sha || !/^[a-f0-9]{40}$/.test(commit.sha))
			throw new Error("corpus discovery has invalid source commit");
		return {
			repository,
			tag: release.tag_name,
			commit: commit.sha,
			acceptance: release.immutable ? "immutable" : "verified-bytes-mutable",
			assets: Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b))),
		};
	}
	const generalInventory = await inventory(repositories.general);
	const general = generalInventory
		.filter(r => /^content-\d{8}T\d{6}Z$/.test(r.tag_name))
		.sort((a, b) => a.tag_name.localeCompare(b.tag_name))
		.at(-1);
	const providers = await inventory(repositories.provider);
	const provider = providers
		.filter(r => stable.test(r.tag_name))
		.sort(compareVersions)
		.at(-1);
	const documentation = providers.find(r => r.tag_name === `documentation-${provider?.tag_name}`);
	if (!documentation) throw new Error("latest provider has no matching documentation release");
	const api = (await inventory(repositories.api))
		.filter(r => stable.test(r.tag_name))
		.sort(compareVersions)
		.at(-1);
	const generalSource = await source(repositories.general, general);
	const enrichment = generalInventory.find(r => r.tag_name === generalSource.tag.replace(/^content-/, "enrichment-"));
	if (enrichment) generalSource.enrichment = await source(repositories.general, enrichment);
	return {
		general: generalSource,
		provider: await source(repositories.provider, provider),
		terraform: await source(repositories.provider, documentation),
		api: await source(repositories.api, api),
	};
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
export function assertFreshCorpusSources(built: CorpusSources, latest: CorpusSources): void {
	for (const family of ["general", "terraform", "provider", "api"] as const) {
		if (canonical(built[family]) !== canonical(latest[family]))
			throw new Error(`stale ${family} corpus source: refresh and rebuild before publication`);
	}
}
export async function requireFreshCorpusSources(): Promise<CorpusSources> {
	const built = JSON.parse(
		await readFile(path.join(import.meta.dir, "../../../tools/corpus-sources.json"), "utf8"),
	) as CorpusSources;
	const latest = await resolveCorpusSources();
	assertFreshCorpusSources(built, latest);
	for (const [family, file] of [
		["general", "documentation-release.json"],
		["terraform", "terraform-documentation-release.json"],
		["api", "spec-release.json"],
	] as const) {
		assertSourceRecord(
			latest[family],
			JSON.parse(await readFile(path.join(import.meta.dir, "../../../tools", file), "utf8")),
		);
	}
	return latest;
}
export function assertSourceRecord(
	source: CorpusSource,
	record: { release_tag: string; source_commit?: string; target_commit?: string; assets: Record<string, unknown> },
): void {
	if (source.tag !== record.release_tag || source.commit !== (record.source_commit ?? record.target_commit))
		throw new Error("stale corpus source record");
	if (canonical(Object.keys(record.assets).sort()) !== canonical(Object.keys(source.assets).sort()))
		throw new Error("stale corpus asset inventory");
	for (const [name, asset] of Object.entries(record.assets)) {
		const expected = source.assets[name];
		if (
			!expected ||
			canonical(asset) !== canonical(typeof asset === "string" ? `sha256:${expected.sha256}` : expected)
		)
			throw new Error(`stale corpus asset record: ${name}`);
	}
}
