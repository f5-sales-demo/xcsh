#!/usr/bin/env bun
/**
 * Generates src/defaults-metadata.generated.ts — the per-kind minimum-settings
 * defaults table consumed by buildMinimalExportFilter().
 *
 * Single source of truth: the api-specs-enriched repo computes the defaults
 * (from config/discovered_defaults.yaml + the enriched OpenAPI specs) and
 * publishes a flat `minimal-export-defaults.json` artifact. This generator just
 * downloads that artifact and emits the typed table — no OpenAPI walking is
 * duplicated here.
 *
 * Source resolution (first hit wins):
 *   1. Exact dispatched release          — when $API_SPECS_VERSION and $API_SPECS_TAG are both set
 *   2. $API_SPECS_DEFAULTS_FILE          — explicit path to the artifact
 *   3. ../../../../api-specs-enriched/docs/specifications/api/minimal-export-defaults.json (local checkout)
 *   4. GitHub latest release asset       — minimal-export-defaults.json from $REPO
 *   5. none found                        — emit an empty table + warn (non-fatal)
 *
 * The empty-table fallback applies only to non-dispatch development: a kind
 * with no entry exports everything (today's behavior). Exact dispatched
 * releases must include a matching artifact and never use this fallback.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { type ApiSpecReleaseIdentity, releaseIdentityFromEnvironment } from "../../../scripts/api-spec-delivery";

const REPO = "f5-sales-demo/api-specs-enriched";
const ARTIFACT_NAME = "minimal-export-defaults.json";
const outputPath = path.resolve(import.meta.dir, "../src/defaults-metadata.generated.ts");

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

interface KindDefaultsMetadata {
	serverDefaultFields: string[];
	fieldDefaults: Record<string, unknown>;
	minimumConfigFields: string[];
	fieldConflicts: Record<string, string[]>;
}

interface DefaultsArtifact {
	version?: string;
	resources: Record<string, Partial<KindDefaultsMetadata>>;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface LoadedArtifact {
	text: string;
	source: string;
}

interface ParsedArtifact {
	table: Record<string, KindDefaultsMetadata>;
	version: string;
}

async function fetchWithRetry(url: string, init?: RequestInit, fetcher: Fetcher = globalThis.fetch): Promise<Response> {
	let lastError: Error | null = null;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		if (attempt > 0) {
			await Bun.sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1));
		}
		try {
			const response = await fetcher(url, init);
			if (response.status === 403 || response.status === 429) {
				const retryAfter = response.headers.get("retry-after");
				const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : INITIAL_BACKOFF_MS * 2 ** attempt;
				console.warn(`  Rate limited (${response.status}), waiting ${waitMs}ms...`);
				await Bun.sleep(waitMs);
				continue;
			}
			return response;
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			console.warn(`  Fetch failed: ${lastError.message}`);
		}
	}
	throw lastError ?? new Error(`Failed to fetch ${url} after ${MAX_RETRIES} retries`);
}

function githubHeaders(): Record<string, string> {
	const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
}

async function resolveLatestTag(fetcher: Fetcher): Promise<string | undefined> {
	try {
		const response = await fetchWithRetry(
			`https://api.github.com/repos/${REPO}/releases/latest`,
			{
				headers: githubHeaders(),
			},
			fetcher,
		);
		if (!response.ok) return undefined;
		const data = (await response.json()) as { tag_name?: string };
		return data.tag_name;
	} catch {
		return undefined;
	}
}

function releaseArtifactUrl(releaseTag: string): string {
	return `https://github.com/${REPO}/releases/download/${releaseTag}/${ARTIFACT_NAME}`;
}

/** Returns the raw artifact JSON text, or undefined if no source is available. */
export async function loadArtifactText(
	env: Record<string, string | undefined> = process.env,
	fetcher: Fetcher = globalThis.fetch,
): Promise<LoadedArtifact | undefined> {
	const releaseIdentity = releaseIdentityFromEnvironment(env);
	if (releaseIdentity) {
		const expectedSha256 = env.API_SPECS_DEFAULTS_SHA256;
		if (!expectedSha256 || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
			throw new Error("API_SPECS_DEFAULTS_SHA256 must be a lowercase SHA-256 digest");
		}
		const url = releaseArtifactUrl(releaseIdentity.releaseTag);
		const response = await fetchWithRetry(url, { redirect: "follow" }, fetcher);
		if (!response.ok) {
			throw new Error(
				`${ARTIFACT_NAME} is absent from dispatched release ${releaseIdentity.releaseTag} (${response.status})`,
			);
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== expectedSha256) {
			throw new Error(`${ARTIFACT_NAME} differs from its immutable publication receipt`);
		}
		return { text: new TextDecoder().decode(bytes), source: url };
	}

	const envFile = env.API_SPECS_DEFAULTS_FILE;
	if (envFile && fs.existsSync(envFile)) {
		return { text: fs.readFileSync(envFile, "utf8"), source: envFile };
	}

	const localCheckout = path.resolve(
		import.meta.dir,
		`../../../../api-specs-enriched/docs/specifications/api/${ARTIFACT_NAME}`,
	);
	if (fs.existsSync(localCheckout)) {
		return { text: fs.readFileSync(localCheckout, "utf8"), source: localCheckout };
	}

	const tag = await resolveLatestTag(fetcher);
	if (tag) {
		const url = releaseArtifactUrl(tag);
		const response = await fetchWithRetry(url, { redirect: "follow" }, fetcher);
		if (response.ok) {
			return { text: await response.text(), source: url };
		}
		console.warn(`  ${ARTIFACT_NAME} not found in release ${tag} (${response.status}).`);
	}

	return undefined;
}

function normalizeEntry(raw: Partial<KindDefaultsMetadata>): KindDefaultsMetadata {
	return {
		serverDefaultFields: [...(raw.serverDefaultFields ?? [])].sort(),
		fieldDefaults: raw.fieldDefaults ?? {},
		minimumConfigFields: [...(raw.minimumConfigFields ?? [])].sort(),
		fieldConflicts: raw.fieldConflicts ?? {},
	};
}

export function parseArtifact(loaded: LoadedArtifact, releaseIdentity?: ApiSpecReleaseIdentity): ParsedArtifact {
	const artifact = JSON.parse(loaded.text) as DefaultsArtifact;
	if (releaseIdentity && artifact.version !== releaseIdentity.version) {
		throw new Error(
			`${ARTIFACT_NAME} version ${String(artifact.version)} does not match dispatched version ${releaseIdentity.version}`,
		);
	}

	const table: Record<string, KindDefaultsMetadata> = {};
	for (const [kind, raw] of Object.entries(artifact.resources ?? {})) {
		table[kind] = normalizeEntry(raw);
	}
	return { table, version: artifact.version ?? "unknown" };
}

function render(table: Record<string, KindDefaultsMetadata>, source: string | undefined, version: string): string {
	const kinds = Object.keys(table).sort();
	const body = JSON.stringify(Object.fromEntries(kinds.map(k => [k, table[k]])), null, "\t");
	const provenance = source
		? `// Source: ${source} (api-specs-enriched ${version})`
		: `// Source: NONE FOUND — empty table (kinds export everything until api-specs-enriched publishes ${ARTIFACT_NAME}).`;
	return `// AUTO-GENERATED by scripts/generate-defaults.ts — DO NOT EDIT BY HAND.
// Per-kind defaults knowledge for minimum-settings export. Regenerate with: bun run generate-defaults
${provenance}
import type { KindDefaultsMetadata } from "./defaults-metadata";

export const DEFAULTS_METADATA: Record<string, KindDefaultsMetadata> = ${body};
`;
}

async function main(): Promise<void> {
	const releaseIdentity = releaseIdentityFromEnvironment(process.env);
	const loaded = await loadArtifactText(process.env);

	let table: Record<string, KindDefaultsMetadata> = {};
	let version = "unknown";
	let source: string | undefined;

	if (loaded) {
		const parsed = parseArtifact(loaded, releaseIdentity);
		table = parsed.table;
		version = parsed.version;
		source = loaded.source;
		console.log(`Loaded ${Object.keys(table).length} kinds from ${loaded.source}`);
	} else {
		console.warn(`WARNING: no ${ARTIFACT_NAME} source found — writing an empty defaults table.`);
		console.warn("  (kinds will export everything; fill api-specs-enriched coverage to enable stripping.)");
		table = {};
	}

	fs.writeFileSync(outputPath, render(table, source, version));
	console.log(`Wrote ${outputPath}`);
}

if (import.meta.main) await main();
