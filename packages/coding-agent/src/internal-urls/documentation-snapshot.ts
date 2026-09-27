import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGunzip, gunzipSync } from "node:zlib";
import { createStore } from "@tobilu/qmd";
import tar from "tar-stream";
import { parse as parseYaml } from "yaml";
import { DOCUMENTATION_SOURCES, type DocumentationSource } from "./documentation-resolve";

const MIB = 1024 * 1024;
export const DOCUMENTATION_LIMITS = {
	archiveBytes: 256 * MIB,
	expandedBytes: 512 * MIB,
	members: 10_000,
	markdownBytes: 2 * MIB,
	assetBytes: 20 * MIB,
} as const;

export const DOCUMENTATION_RELEASE_ASSETS = [
	"html-to-markdown-content.tar.gz",
	"html-to-markdown-content.tar.gz.sha256",
	"manifest.json",
	"publication.json",
	"quality-report.json",
	"quality-report.md",
] as const;
const RECEIPT_ASSETS = DOCUMENTATION_RELEASE_ASSETS.filter(name => name !== "publication.json");
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const RELEASE_TAG = /^content-[0-9]{8}T[0-9]{6}Z$/;
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const FIXED_TIME = "2000-01-01T00:00:00.000Z";
const MANIFEST_KEYS = [
	"asset_count",
	"assets",
	"counts",
	"documents",
	"ended_at",
	"failures",
	"page_count",
	"quality_status_counts",
	"removals",
	"schema_version",
	"source_roots",
	"started_at",
	"tool_version",
] as const;
const MANIFEST_DOCUMENT_KEYS = [
	"body_sha256",
	"file_sha256",
	"path",
	"provenance",
	"size_bytes",
	"sourceId",
	"url",
] as const;
const MANIFEST_ASSET_KEYS = ["media_type", "path", "sha256", "size_bytes"] as const;
const DOCUMENT_PROVENANCE_KEYS = [
	"consecutive_failure_count",
	"current_failure",
	"freshness",
	"last_success_at",
	"terminal_confirmation_count",
] as const;
const SOURCE_ROOT_URLS: Readonly<Record<DocumentationSource, string>> = {
	"docs-cloud-f5-com": "https://docs.cloud.f5.com/docs-v2",
	"my-f5-com": "https://my.f5.com/manage/s",
};

export interface DocumentationReleaseAssetPin {
	readonly sha256: string;
	readonly size_bytes: number;
}

export interface DocumentationReleasePin {
	readonly schema_version: 1;
	readonly source_repository: "f5-sales-demo/html-to-markdown";
	readonly release_tag: string;
	readonly source_commit: string;
	readonly receipt_sha256: string;
	readonly assets: Readonly<Record<(typeof DOCUMENTATION_RELEASE_ASSETS)[number], DocumentationReleaseAssetPin>>;
	readonly manifest: {
		readonly schema_version: 2;
		readonly document_count: number;
		readonly asset_count: number;
		readonly source_roots: readonly DocumentationSource[];
	};
	readonly index: {
		readonly qmd_version: "2.8.3";
		readonly fingerprint: string;
		readonly sha256: string;
		readonly size_bytes: number;
	};
}

export interface VerifiedDocumentationDocument {
	readonly source: DocumentationSource;
	readonly stablePath: string;
	readonly archivePath: string;
	readonly title: string;
	readonly originalUrl: string;
	readonly bodySha256: string;
	readonly fileSha256: string;
	readonly sizeBytes: number;
	readonly markdown: string;
}

export interface VerifiedDocumentationAsset {
	readonly source: DocumentationSource;
	readonly stablePath: string;
	readonly filename: string;
	readonly archivePath: string;
	readonly mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
	readonly sha256: string;
	readonly sizeBytes: number;
}

export interface VerifiedDocumentationSnapshot {
	readonly archivePath: string;
	readonly releaseTag: string;
	readonly sourceCommit: string;
	readonly archiveSha256: string;
	readonly documents: readonly VerifiedDocumentationDocument[];
	readonly assets: readonly VerifiedDocumentationAsset[];
}

export interface DocumentationIndexResult {
	readonly fingerprint: string;
	readonly sha256: string;
	readonly sizeBytes: number;
}

export interface VerifiedPrebuiltDocumentationAssets {
	readonly indexGzip: Buffer;
}

interface ScannedArchiveEntry {
	readonly name: string;
	readonly size: number;
	readonly sha256: string;
	readonly data?: Buffer;
}

function object(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
	const actual = Object.keys(value).sort();
	if (JSON.stringify(actual) !== JSON.stringify([...expected].sort()))
		throw new Error(`${field} has an invalid shape`);
}

function string(value: unknown, field: string): string {
	if (typeof value !== "string" || !value) throw new Error(`${field} must be a non-empty string`);
	return value;
}

function count(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw new Error(`${field} must be a non-negative integer`);
	return value as number;
}

function validateCountMap(value: unknown, field: string): void {
	for (const [name, item] of Object.entries(object(value, field))) {
		if (!name) throw new Error(`${field} contains an empty key`);
		count(item, `${field}.${name}`);
	}
}

function validateTimestamp(value: unknown, field: string): string {
	const result = string(value, field);
	if (!TIMESTAMP.test(result)) throw new Error(`${field} is invalid`);
	return result;
}

function validateOriginalUrl(value: unknown, source: DocumentationSource, field: string): string {
	const result = string(value, field);
	const root = SOURCE_ROOT_URLS[source];
	if (result !== root && !result.startsWith(`${root}/`) && !result.startsWith(`${root}?`)) {
		throw new Error(`${field} is outside the declared source root`);
	}
	return result;
}

export function sha256Bytes(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) hash.update(chunk);
	return hash.digest("hex");
}

export function parseDocumentationReleasePin(value: unknown): DocumentationReleasePin {
	const pin = object(value, "documentation release pin");
	exactKeys(
		pin,
		[
			"schema_version",
			"source_repository",
			"release_tag",
			"source_commit",
			"receipt_sha256",
			"assets",
			"manifest",
			"index",
		],
		"documentation release pin",
	);
	if (pin.schema_version !== 1) throw new Error("documentation release pin schema version is invalid");
	if (pin.source_repository !== "f5-sales-demo/html-to-markdown")
		throw new Error("documentation source repository is invalid");
	const releaseTag = string(pin.release_tag, "release_tag");
	if (!RELEASE_TAG.test(releaseTag)) throw new Error("documentation release tag is invalid");
	const sourceCommit = string(pin.source_commit, "source_commit");
	if (!COMMIT.test(sourceCommit)) throw new Error("documentation source commit is invalid");
	const receiptSha256 = string(pin.receipt_sha256, "receipt_sha256");
	if (!SHA256.test(receiptSha256)) throw new Error("documentation receipt digest is invalid");

	const assetsValue = object(pin.assets, "documentation release assets");
	exactKeys(assetsValue, DOCUMENTATION_RELEASE_ASSETS, "documentation release assets");
	const assets = {} as Record<(typeof DOCUMENTATION_RELEASE_ASSETS)[number], DocumentationReleaseAssetPin>;
	for (const name of DOCUMENTATION_RELEASE_ASSETS) {
		const asset = object(assetsValue[name], `documentation release asset ${name}`);
		exactKeys(asset, ["sha256", "size_bytes"], `documentation release asset ${name}`);
		const digest = string(asset.sha256, `${name}.sha256`);
		if (!SHA256.test(digest)) throw new Error(`${name}.sha256 is invalid`);
		assets[name] = { sha256: digest, size_bytes: count(asset.size_bytes, `${name}.size_bytes`) };
	}

	const manifestValue = object(pin.manifest, "documentation manifest pin");
	exactKeys(
		manifestValue,
		["schema_version", "document_count", "asset_count", "source_roots"],
		"documentation manifest pin",
	);
	if (manifestValue.schema_version !== 2) throw new Error("documentation manifest schema version is invalid");
	const roots = manifestValue.source_roots;
	if (
		!Array.isArray(roots) ||
		JSON.stringify([...roots].sort()) !== JSON.stringify([...DOCUMENTATION_SOURCES].sort())
	) {
		throw new Error("documentation source roots are invalid");
	}

	const indexValue = object(pin.index, "documentation index pin");
	exactKeys(indexValue, ["qmd_version", "fingerprint", "sha256", "size_bytes"], "documentation index pin");
	if (indexValue.qmd_version !== "2.8.3") throw new Error("documentation QMD version is invalid");
	for (const field of ["fingerprint", "sha256"] as const) {
		const digest = string(indexValue[field], `documentation index ${field}`);
		if (digest !== "pending" && !SHA256.test(digest)) throw new Error(`documentation index ${field} is invalid`);
	}

	return {
		schema_version: 1,
		source_repository: "f5-sales-demo/html-to-markdown",
		release_tag: releaseTag,
		source_commit: sourceCommit,
		receipt_sha256: receiptSha256,
		assets,
		manifest: {
			schema_version: 2,
			document_count: count(manifestValue.document_count, "manifest.document_count"),
			asset_count: count(manifestValue.asset_count, "manifest.asset_count"),
			source_roots: roots as DocumentationSource[],
		},
		index: {
			qmd_version: "2.8.3",
			fingerprint: indexValue.fingerprint as string,
			sha256: indexValue.sha256 as string,
			size_bytes: count(indexValue.size_bytes, "index.size_bytes"),
		},
	};
}

function validateMemberName(name: string): void {
	if (!name || name.startsWith("/") || name.includes("\\") || name.includes("%")) {
		throw new Error(`archive contains an invalid member path: ${name}`);
	}
	const parts = name.split("/");
	if (parts.some(part => !part || part === "." || part === "..")) {
		throw new Error(`archive contains an invalid member path: ${name}`);
	}
	if (["SHA256SUMS", "manifest.json", "quality-report.json", "quality-report.md"].includes(name)) return;
	if (parts[0] !== "content" || !DOCUMENTATION_SOURCES.includes(parts[1] as DocumentationSource) || parts.length < 4) {
		throw new Error(`archive contains an unknown member: ${name}`);
	}
	if (name.endsWith("/index.md")) return;
	if (parts.slice(2, -1).includes("assets") && parts.at(-1)!.length > 1) return;
	throw new Error(`archive contains an unknown member: ${name}`);
}

async function scanArchive(
	archivePath: string,
	collect: (name: string) => boolean,
): Promise<Map<string, ScannedArchiveEntry>> {
	if ((await stat(archivePath)).size > DOCUMENTATION_LIMITS.archiveBytes)
		throw new Error("documentation archive exceeds limit");
	const entries = new Map<string, ScannedArchiveEntry>();
	const source = createReadStream(archivePath);
	const gunzip = createGunzip();
	const extract = tar.extract();
	let expanded = 0;
	let members = 0;

	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			source.destroy();
			gunzip.destroy();
			extract.destroy();
			reject(error instanceof Error ? error : new Error(String(error)));
		};
		extract.on("entry", (header, stream, next) => {
			let memberSize: number;
			try {
				members += 1;
				if (members > DOCUMENTATION_LIMITS.members)
					throw new Error("documentation archive member count exceeds limit");
				if (header.type !== "file") throw new Error(`archive member type is not allowed: ${header.name}`);
				validateMemberName(header.name);
				const declaredSize = header.size;
				if (typeof declaredSize !== "number" || !Number.isSafeInteger(declaredSize) || declaredSize < 0) {
					throw new Error(`archive member has an invalid size: ${header.name}`);
				}
				memberSize = declaredSize;
				if (entries.has(header.name)) throw new Error(`archive contains a duplicate member: ${header.name}`);
				if (header.name.endsWith("/index.md") && memberSize > DOCUMENTATION_LIMITS.markdownBytes) {
					throw new Error(`Markdown member exceeds limit: ${header.name}`);
				}
				if (header.name.includes("/assets/") && memberSize > DOCUMENTATION_LIMITS.assetBytes) {
					throw new Error(`asset member exceeds limit: ${header.name}`);
				}
				expanded += memberSize;
				if (expanded > DOCUMENTATION_LIMITS.expandedBytes)
					throw new Error("documentation expanded payload exceeds limit");
			} catch (error) {
				fail(error);
				return;
			}
			const hash = createHash("sha256");
			const chunks: Buffer[] | undefined = collect(header.name) ? [] : undefined;
			let bytes = 0;
			stream.on("data", chunk => {
				const data = Buffer.from(chunk);
				bytes += data.byteLength;
				hash.update(data);
				chunks?.push(data);
			});
			stream.on("error", fail);
			stream.on("end", () => {
				if (bytes !== memberSize) return fail(new Error(`archive member size mismatch: ${header.name}`));
				entries.set(header.name, {
					name: header.name,
					size: bytes,
					sha256: hash.digest("hex"),
					data: chunks ? Buffer.concat(chunks) : undefined,
				});
				next();
			});
		});
		extract.on("finish", () => {
			if (!settled) {
				settled = true;
				resolve();
			}
		});
		source.on("error", fail);
		gunzip.on("error", fail);
		extract.on("error", fail);
		source.pipe(gunzip).pipe(extract);
	});
	if (members === 0) throw new Error("documentation archive is empty");
	return entries;
}

function parseJson(bytes: Buffer, field: string): Record<string, unknown> {
	try {
		return object(JSON.parse(bytes.toString("utf8")), field);
	} catch (error) {
		throw new Error(`${field} is not valid JSON`, { cause: error });
	}
}

function parseSums(bytes: Buffer): Map<string, string> {
	const sums = new Map<string, string>();
	for (const line of bytes.toString("utf8").split("\n")) {
		if (!line) continue;
		const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
		if (!match) throw new Error("SHA256SUMS contains a malformed entry");
		validateMemberName(match[2]!);
		if (sums.has(match[2]!)) throw new Error(`SHA256SUMS contains a duplicate entry: ${match[2]}`);
		sums.set(match[2]!, match[1]!);
	}
	return sums;
}

function normalizeBody(value: string): string {
	const lines = value
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.split("\n")
		.map(line => line.trimEnd());
	return `${lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}

function splitDocument(markdown: string): { metadata: Record<string, unknown>; body: string } {
	const match = /^---\n(.*?)\n---\n\n?(.*)$/s.exec(markdown);
	if (!match) throw new Error("document has no YAML frontmatter");
	return { metadata: object(parseYaml(match[1]!), "frontmatter"), body: normalizeBody(match[2]!) };
}

function mediaType(name: string): VerifiedDocumentationAsset["mimeType"] {
	if (name.endsWith(".png")) return "image/png";
	if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
	if (name.endsWith(".gif")) return "image/gif";
	if (name.endsWith(".webp")) return "image/webp";
	if (name.endsWith(".svg")) return "image/svg+xml";
	throw new Error(`unsupported documentation asset type: ${name}`);
}

function stableDocumentPath(archivePath: string, source: DocumentationSource): string {
	const prefix = `content/${source}/`;
	if (!archivePath.startsWith(prefix) || !archivePath.endsWith("/index.md"))
		throw new Error(`invalid document path: ${archivePath}`);
	return archivePath.slice(prefix.length, -"/index.md".length);
}

function stableAssetPath(archivePath: string, source: DocumentationSource): { stablePath: string; filename: string } {
	const prefix = `content/${source}/`;
	if (!archivePath.startsWith(prefix)) throw new Error(`invalid asset path: ${archivePath}`);
	const relative = archivePath.slice(prefix.length);
	const marker = "/assets/";
	const index = relative.lastIndexOf(marker);
	if (index <= 0) throw new Error(`invalid asset path: ${archivePath}`);
	return { stablePath: relative.slice(0, index), filename: relative.slice(index + marker.length) };
}

async function verifyOuterAssets(root: string, pin: DocumentationReleasePin): Promise<void> {
	const actual = (await readdir(root, { withFileTypes: true }))
		.filter(entry => entry.isFile())
		.map(entry => entry.name)
		.sort();
	if (JSON.stringify(actual) !== JSON.stringify([...DOCUMENTATION_RELEASE_ASSETS].sort())) {
		throw new Error("documentation release asset set mismatch");
	}
	for (const name of DOCUMENTATION_RELEASE_ASSETS) {
		const filePath = path.join(root, name);
		const fileStat = await stat(filePath);
		if (fileStat.size !== pin.assets[name].size_bytes)
			throw new Error(`documentation release asset size mismatch: ${name}`);
		if ((await sha256File(filePath)) !== pin.assets[name].sha256)
			throw new Error(`documentation release asset digest mismatch: ${name}`);
	}
}

function verifyReceipt(bytes: Buffer, pin: DocumentationReleasePin): void {
	if (sha256Bytes(bytes) !== pin.receipt_sha256) throw new Error("documentation receipt digest mismatch");
	const receipt = parseJson(bytes, "publication receipt");
	exactKeys(
		receipt,
		["schema_version", "release_tag", "source_commit", "created_at", "published_at", "assets"],
		"publication receipt",
	);
	if (
		receipt.schema_version !== 1 ||
		receipt.release_tag !== pin.release_tag ||
		receipt.source_commit !== pin.source_commit
	) {
		throw new Error("documentation publication identity mismatch");
	}
	if (!TIMESTAMP.test(String(receipt.created_at)) || !TIMESTAMP.test(String(receipt.published_at))) {
		throw new Error("documentation publication timestamps are invalid");
	}
	if (!Array.isArray(receipt.assets)) throw new Error("documentation publication assets must be a list");
	const actual = new Map<string, DocumentationReleaseAssetPin>();
	for (const value of receipt.assets) {
		const asset = object(value, "publication asset");
		exactKeys(asset, ["name", "sha256", "size_bytes"], "publication asset");
		const name = string(asset.name, "publication asset name");
		if (actual.has(name)) throw new Error(`duplicate publication asset: ${name}`);
		actual.set(name, {
			sha256: string(asset.sha256, `${name}.sha256`),
			size_bytes: count(asset.size_bytes, `${name}.size_bytes`),
		});
	}
	if (JSON.stringify([...actual.keys()].sort()) !== JSON.stringify([...RECEIPT_ASSETS].sort())) {
		throw new Error("documentation publication asset set mismatch");
	}
	for (const name of RECEIPT_ASSETS) {
		if (JSON.stringify(actual.get(name)) !== JSON.stringify(pin.assets[name])) {
			throw new Error(`documentation publication asset mismatch: ${name}`);
		}
	}
}

export async function verifyDocumentationRelease(
	root: string,
	rawPin: unknown,
): Promise<VerifiedDocumentationSnapshot> {
	const pin = parseDocumentationReleasePin(rawPin);
	await verifyOuterAssets(root, pin);
	verifyReceipt(await readFile(path.join(root, "publication.json")), pin);
	const outer = (await readFile(path.join(root, "html-to-markdown-content.tar.gz.sha256"), "utf8")).trim();
	if (outer !== `${pin.assets["html-to-markdown-content.tar.gz"].sha256}  html-to-markdown-content.tar.gz`) {
		throw new Error("documentation outer checksum mismatch");
	}

	const archivePath = path.join(root, "html-to-markdown-content.tar.gz");
	const entries = await scanArchive(
		archivePath,
		name => name.endsWith("/index.md") || name === "manifest.json" || name === "SHA256SUMS",
	);
	const manifestEntry = entries.get("manifest.json");
	const sumsEntry = entries.get("SHA256SUMS");
	if (!manifestEntry?.data || !sumsEntry?.data) throw new Error("documentation archive is missing required metadata");
	if (!manifestEntry.data.equals(await readFile(path.join(root, "manifest.json"))))
		throw new Error("documentation manifest copy mismatch");

	const sums = parseSums(sumsEntry.data);
	const expectedNames = [...entries.keys()].filter(name => name !== "SHA256SUMS").sort();
	if (JSON.stringify([...sums.keys()].sort()) !== JSON.stringify(expectedNames))
		throw new Error("SHA256SUMS member set mismatch");
	for (const [name, digest] of sums) {
		if (entries.get(name)?.sha256 !== digest) throw new Error(`SHA256SUMS digest mismatch: ${name}`);
	}

	const manifest = parseJson(manifestEntry.data, "documentation manifest");
	exactKeys(manifest, MANIFEST_KEYS, "documentation manifest");
	if (manifest.schema_version !== 2) throw new Error("documentation manifest schema version is invalid");
	string(manifest.tool_version, "documentation manifest tool version");
	validateTimestamp(manifest.started_at, "documentation manifest started_at");
	validateTimestamp(manifest.ended_at, "documentation manifest ended_at");
	validateCountMap(manifest.counts, "documentation manifest counts");
	validateCountMap(manifest.quality_status_counts, "documentation manifest quality status counts");
	if (!Array.isArray(manifest.removals) || !Array.isArray(manifest.failures)) {
		throw new Error("documentation manifest removal and failure records must be lists");
	}
	const sourceRoots = object(manifest.source_roots, "documentation source roots");
	if (JSON.stringify(Object.keys(sourceRoots).sort()) !== JSON.stringify([...DOCUMENTATION_SOURCES].sort())) {
		throw new Error("documentation required source roots are missing");
	}
	for (const source of DOCUMENTATION_SOURCES) {
		if (sourceRoots[source] !== SOURCE_ROOT_URLS[source]) {
			throw new Error(`documentation source root is invalid: ${source}`);
		}
	}
	if (!Array.isArray(manifest.documents) || !Array.isArray(manifest.assets))
		throw new Error("documentation manifest entries are invalid");
	if (
		count(manifest.page_count, "documentation manifest page_count") !== manifest.documents.length ||
		count(manifest.asset_count, "documentation manifest asset_count") !== manifest.assets.length
	) {
		throw new Error("documentation manifest counts do not match entries");
	}
	if (
		manifest.documents.length !== pin.manifest.document_count ||
		manifest.assets.length !== pin.manifest.asset_count
	) {
		throw new Error("documentation manifest counts do not match pin");
	}

	const seen = new Set<string>();
	const documents = manifest.documents.map((value, position): VerifiedDocumentationDocument => {
		const item = object(value, `manifest document ${position}`);
		exactKeys(item, MANIFEST_DOCUMENT_KEYS, `manifest document ${position}`);
		const provenance = object(item.provenance, `manifest document ${position}.provenance`);
		exactKeys(provenance, DOCUMENT_PROVENANCE_KEYS, `manifest document ${position}.provenance`);
		count(provenance.consecutive_failure_count, `manifest document ${position}.consecutive_failure_count`);
		count(provenance.terminal_confirmation_count, `manifest document ${position}.terminal_confirmation_count`);
		string(provenance.freshness, `manifest document ${position}.freshness`);
		validateTimestamp(provenance.last_success_at, `manifest document ${position}.last_success_at`);
		if (
			provenance.current_failure !== null &&
			(typeof provenance.current_failure !== "object" || Array.isArray(provenance.current_failure))
		) {
			throw new Error(`manifest document ${position}.current_failure is invalid`);
		}
		const archiveMemberPath = string(item.path, `manifest document ${position}.path`);
		if (seen.has(archiveMemberPath)) throw new Error(`duplicate manifest path: ${archiveMemberPath}`);
		seen.add(archiveMemberPath);
		const entry = entries.get(archiveMemberPath);
		if (!entry?.data) throw new Error(`manifest document is missing: ${archiveMemberPath}`);
		const source = string(item.sourceId, "manifest document source") as DocumentationSource;
		if (!DOCUMENTATION_SOURCES.includes(source)) throw new Error(`unknown manifest document source: ${source}`);
		const markdown = entry.data.toString("utf8");
		const parsed = splitDocument(markdown);
		const originalUrl = validateOriginalUrl(item.url, source, "manifest document URL");
		if (parsed.metadata.sourceId !== source || parsed.metadata.url !== originalUrl)
			throw new Error(`manifest document frontmatter mismatch: ${archiveMemberPath}`);
		const bodySha256 = string(item.body_sha256, "manifest document body hash");
		const fileSha256 = string(item.file_sha256, "manifest document file hash");
		const sizeBytes = count(item.size_bytes, "manifest document size");
		if (sha256Bytes(parsed.body) !== bodySha256 || parsed.metadata.content_hash !== bodySha256)
			throw new Error(`manifest document body hash mismatch: ${archiveMemberPath}`);
		if (entry.sha256 !== fileSha256) throw new Error(`manifest document file hash mismatch: ${archiveMemberPath}`);
		if (entry.size !== sizeBytes) throw new Error(`manifest document size mismatch: ${archiveMemberPath}`);
		return {
			source,
			stablePath: stableDocumentPath(archiveMemberPath, source),
			archivePath: archiveMemberPath,
			title: string(parsed.metadata.title, "document title"),
			originalUrl,
			bodySha256,
			fileSha256,
			sizeBytes,
			markdown,
		};
	});

	const assets = manifest.assets.map((value, position): VerifiedDocumentationAsset => {
		const item = object(value, `manifest asset ${position}`);
		exactKeys(item, MANIFEST_ASSET_KEYS, `manifest asset ${position}`);
		const archiveMemberPath = string(item.path, `manifest asset ${position}.path`);
		if (seen.has(archiveMemberPath)) throw new Error(`duplicate manifest path: ${archiveMemberPath}`);
		seen.add(archiveMemberPath);
		const entry = entries.get(archiveMemberPath);
		if (!entry) throw new Error(`manifest asset is missing: ${archiveMemberPath}`);
		const source = archiveMemberPath.split("/")[1] as DocumentationSource;
		if (!DOCUMENTATION_SOURCES.includes(source)) throw new Error(`unknown manifest asset source: ${source}`);
		const parsed = stableAssetPath(archiveMemberPath, source);
		const digest = string(item.sha256, "manifest asset hash");
		if (!SHA256.test(digest) || !parsed.filename.startsWith(`${digest}.`)) {
			throw new Error(`manifest asset digest filename mismatch: ${archiveMemberPath}`);
		}
		const sizeBytes = count(item.size_bytes, "manifest asset size");
		const expectedMediaType = mediaType(archiveMemberPath);
		if (entry.sha256 !== digest) throw new Error(`manifest asset hash mismatch: ${archiveMemberPath}`);
		if (entry.size !== sizeBytes) throw new Error(`manifest asset size mismatch: ${archiveMemberPath}`);
		if (item.media_type !== expectedMediaType)
			throw new Error(`manifest asset media type mismatch: ${archiveMemberPath}`);
		return {
			source,
			...parsed,
			archivePath: archiveMemberPath,
			mimeType: expectedMediaType,
			sha256: digest,
			sizeBytes,
		};
	});
	const contentNames = [...entries.keys()].filter(name => name.startsWith("content/")).sort();
	if (JSON.stringify([...seen].sort()) !== JSON.stringify(contentNames))
		throw new Error("documentation manifest content member set mismatch");

	return {
		archivePath,
		releaseTag: pin.release_tag,
		sourceCommit: pin.source_commit,
		archiveSha256: pin.assets["html-to-markdown-content.tar.gz"].sha256,
		documents: documents.sort((left, right) => left.archivePath.localeCompare(right.archivePath)),
		assets: assets.sort((left, right) => left.archivePath.localeCompare(right.archivePath)),
	};
}

function fingerprint(snapshot: VerifiedDocumentationSnapshot): string {
	return sha256Bytes(
		JSON.stringify({
			archiveSha256: snapshot.archiveSha256,
			releaseTag: snapshot.releaseTag,
			sourceCommit: snapshot.sourceCommit,
			qmdVersion: "2.8.3",
			documents: snapshot.documents.map(({ archivePath, bodySha256, fileSha256, sizeBytes }) => ({
				archivePath,
				bodySha256,
				fileSha256,
				sizeBytes,
			})),
			assets: snapshot.assets.map(({ archivePath, mimeType, sha256, sizeBytes }) => ({
				archivePath,
				mimeType,
				sha256,
				sizeBytes,
			})),
		}),
	);
}

function canonicalizeDatabase(
	databasePath: string,
	snapshot: VerifiedDocumentationSnapshot,
	indexFingerprint: string,
): void {
	const db = new Database(databasePath);
	try {
		db.exec("PRAGMA secure_delete = ON");
		db.exec("BEGIN");
		db.query("UPDATE content SET created_at = ?").run(FIXED_TIME);
		db.query("UPDATE documents SET created_at = ?, modified_at = ?").run(FIXED_TIME, FIXED_TIME);
		for (const source of DOCUMENTATION_SOURCES) {
			db.query("UPDATE store_collections SET path = ? WHERE name = ?").run(`/xcsh-documentation/${source}`, source);
		}
		db.exec("DELETE FROM store_config");
		db.query("INSERT INTO store_config (key, value) VALUES (?, ?)").run("fts_cjk_normalized_version", "1");
		db.exec(`CREATE TABLE documentation_provenance (
			key TEXT PRIMARY KEY NOT NULL,
			value TEXT NOT NULL
		)`);
		db.exec(`CREATE TABLE documentation_documents (
			source TEXT NOT NULL,
			stable_path TEXT NOT NULL,
			archive_path TEXT NOT NULL UNIQUE,
			title TEXT NOT NULL,
			original_url TEXT NOT NULL,
			body_sha256 TEXT NOT NULL,
			file_sha256 TEXT NOT NULL,
			size_bytes INTEGER NOT NULL,
			markdown TEXT NOT NULL,
			PRIMARY KEY (source, stable_path)
		)`);
		db.exec(`CREATE TABLE documentation_assets (
			source TEXT NOT NULL,
			stable_path TEXT NOT NULL,
			filename TEXT NOT NULL,
			archive_path TEXT NOT NULL UNIQUE,
			mime_type TEXT NOT NULL,
			sha256 TEXT NOT NULL,
			size_bytes INTEGER NOT NULL,
			PRIMARY KEY (source, stable_path, filename)
		)`);
		const provenance = db.query("INSERT INTO documentation_provenance (key, value) VALUES (?, ?)");
		for (const [key, value] of Object.entries({
			archive_sha256: snapshot.archiveSha256,
			asset_count: String(snapshot.assets.length),
			document_count: String(snapshot.documents.length),
			fingerprint: indexFingerprint,
			release_tag: snapshot.releaseTag,
			source_commit: snapshot.sourceCommit,
		}).sort(([left], [right]) => left.localeCompare(right)))
			provenance.run(key, value);
		const insertDocument = db.query("INSERT INTO documentation_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
		for (const document of snapshot.documents) {
			insertDocument.run(
				document.source,
				document.stablePath,
				document.archivePath,
				document.title,
				document.originalUrl,
				document.bodySha256,
				document.fileSha256,
				document.sizeBytes,
				document.markdown,
			);
		}
		const insertAsset = db.query("INSERT INTO documentation_assets VALUES (?, ?, ?, ?, ?, ?, ?)");
		for (const asset of snapshot.assets) {
			insertAsset.run(
				asset.source,
				asset.stablePath,
				asset.filename,
				asset.archivePath,
				asset.mimeType,
				asset.sha256,
				asset.sizeBytes,
			);
		}
		db.exec("COMMIT");
		db.exec("VACUUM");
		db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	} catch (error) {
		try {
			db.exec("ROLLBACK");
		} catch {
			/* transaction may already be closed */
		}
		throw error;
	} finally {
		db.close();
	}
}

function verifyIndexedBodies(databasePath: string, snapshot: VerifiedDocumentationSnapshot): void {
	const db = new Database(databasePath, { readonly: true });
	try {
		const rows = db
			.query(`SELECT d.collection AS source, d.path, c.doc AS markdown
			FROM documents d JOIN content c ON c.hash = d.hash WHERE d.active = 1
			ORDER BY d.collection, d.path`)
			.all() as Array<{ source: string; path: string; markdown: string }>;
		if (rows.length !== snapshot.documents.length) throw new Error("documentation index document count mismatch");
		const expected = new Map(
			snapshot.documents.map(document => [`${document.source}/${document.stablePath}/index.md`, document.markdown]),
		);
		for (const row of rows) {
			const key = `${row.source}/${row.path.replaceAll("\\", "/")}`;
			if (expected.get(key) !== row.markdown) throw new Error(`documentation index body mismatch: ${key}`);
		}
	} finally {
		db.close();
	}
}

function canonicalizeSqliteHeader(bytes: Buffer): Buffer {
	const header = "SQLite format 3\0";
	if (bytes.byteLength < 100 || bytes.subarray(0, header.length).toString("ascii") !== header) {
		throw new Error("documentation index is not a valid SQLite database");
	}
	const canonical = Buffer.from(bytes);
	// SQLite's file change counter and version-valid-for number describe the
	// connection's write history, not database content. Their values can differ
	// across Bun's platform builds even when every page after the header is
	// identical. Keep the required equality while removing that host history.
	canonical.writeUInt32BE(1, 24);
	canonical.writeUInt32BE(1, 92);
	// The producing SQLite library version is informational and differs between
	// Bun's release-platform builds. It does not affect the file format.
	canonical.writeUInt32BE(3_000_000, 96);
	return canonical;
}

export async function buildDocumentationIndex(
	snapshot: VerifiedDocumentationSnapshot,
	outputPath: string,
): Promise<DocumentationIndexResult> {
	const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "xcsh-documentation-index-"));
	const documentsRoot = path.join(stagingRoot, "content");
	const databasePath = path.join(stagingRoot, "documentation.sqlite");
	const indexFingerprint = fingerprint(snapshot);
	try {
		for (const source of DOCUMENTATION_SOURCES) await mkdir(path.join(documentsRoot, source), { recursive: true });
		const store = await createStore({
			dbPath: databasePath,
			config: {
				collections: {
					"docs-cloud-f5-com": {
						path: path.join(documentsRoot, "docs-cloud-f5-com"),
						pattern: "**/*.md",
						context: { "/": "F5 Distributed Cloud conceptual and operational documentation" },
					},
					"my-f5-com": {
						path: path.join(documentsRoot, "my-f5-com"),
						pattern: "**/*.md",
						context: { "/": "MyF5 support and knowledge-base documentation" },
					},
				},
			},
		});
		try {
			for (const document of snapshot.documents) {
				store.internal.insertContent(document.fileSha256, document.markdown, FIXED_TIME);
				store.internal.insertDocument(
					document.source,
					`${document.stablePath}/index.md`,
					document.title,
					document.fileSha256,
					FIXED_TIME,
					FIXED_TIME,
				);
			}
			store.internal.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
			store.internal.db.exec("PRAGMA journal_mode = DELETE");
		} finally {
			await store.close();
		}
		canonicalizeDatabase(databasePath, snapshot, indexFingerprint);
		verifyIndexedBodies(databasePath, snapshot);
		await mkdir(path.dirname(outputPath), { recursive: true });
		const stagingOutput = `${outputPath}.tmp`;
		await rm(stagingOutput, { force: true });
		const bytes = canonicalizeSqliteHeader(await readFile(databasePath));
		await writeFile(stagingOutput, bytes, { mode: 0o600 });
		await rename(stagingOutput, outputPath);
		return { fingerprint: indexFingerprint, sha256: sha256Bytes(bytes), sizeBytes: bytes.byteLength };
	} finally {
		await rm(stagingRoot, { recursive: true, force: true });
	}
}

export async function verifyPrebuiltDocumentationAssets(
	root: string,
	pin: DocumentationReleasePin,
): Promise<VerifiedPrebuiltDocumentationAssets> {
	if (pin.index.sha256 === "pending" || pin.index.fingerprint === "pending" || pin.index.size_bytes === 0) {
		throw new Error("prebuilt documentation index requires a complete index pin");
	}
	const archivePath = path.join(root, "html-to-markdown-content.tar.gz");
	const archive = await stat(archivePath);
	if (
		archive.size !== pin.assets["html-to-markdown-content.tar.gz"].size_bytes ||
		(await sha256File(archivePath)) !== pin.assets["html-to-markdown-content.tar.gz"].sha256
	) {
		throw new Error("prebuilt documentation archive disagrees with pin");
	}
	const indexGzip = await readFile(path.join(root, "documentation-index.sqlite.gz"));
	if (indexGzip.byteLength > pin.index.size_bytes) {
		throw new Error("prebuilt compressed documentation index exceeds its expanded size");
	}
	let index: Buffer;
	try {
		index = gunzipSync(indexGzip, { maxOutputLength: pin.index.size_bytes + 1 });
	} catch (error) {
		throw new Error("prebuilt documentation index is not valid bounded gzip", { cause: error });
	}
	if (index.byteLength !== pin.index.size_bytes || sha256Bytes(index) !== pin.index.sha256) {
		throw new Error("prebuilt documentation index disagrees with pin");
	}
	return { indexGzip };
}

export async function extractVerifiedDocumentationAsset(
	archivePath: string,
	asset: VerifiedDocumentationAsset,
	cacheRoot: string,
	releaseTag: string,
): Promise<string> {
	const directory = path.join(cacheRoot, releaseTag);
	const destination = path.join(directory, asset.filename);
	try {
		if ((await stat(destination)).size === asset.sizeBytes && (await sha256File(destination)) === asset.sha256)
			return destination;
	} catch {
		/* missing or corrupt cache is repaired below */
	}
	await mkdir(directory, { recursive: true });
	const entries = await scanArchive(archivePath, name => name === asset.archivePath);
	const entry = entries.get(asset.archivePath);
	if (!entry?.data || entry.size !== asset.sizeBytes || entry.sha256 !== asset.sha256)
		throw new Error("documentation asset checksum mismatch");
	const staging = `${destination}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(staging, entry.data, { mode: 0o600 });
	await rename(staging, destination);
	return destination;
}
