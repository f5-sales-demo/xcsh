import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { createStore } from "@tobilu/qmd";
import tar from "tar-stream";
import { parse as parseYaml } from "yaml";
import { type DocumentationPassage, githubHeadingAnchor } from "./documentation-metadata";
import type { InternalResource, InternalUrl } from "./types";

export const TERRAFORM_ASSETS = ["terraform-docs.tar.gz", "manifest.json", "publication.json", "SHA256SUMS"] as const;
export interface TerraformMetadata {
	id: string;
	canonical_id: string;
	path: string;
	provider_type: string;
	provider_name: string;
	role: string;
	schema_path: string[];
	summary: string;
	aliases: string[];
	parent_id: string | null;
	child_ids: string[];
	projection_part?: number;
	[key: string]: unknown;
}
export interface TerraformDocument {
	path: string;
	size_bytes: number;
	sha256: string;
	body_sha256: string;
	metadata: TerraformMetadata;
	markdown: string;
	body: string;
}
export interface TerraformPin {
	schema_version: 1;
	source_repository: "f5-sales-demo/terraform-provider-xcsh";
	provider_version: string;
	release_tag: string;
	source_commit: string;
	receipt_sha256: string;
	document_count: number;
	provider_schema_digest: string;
	spec_pin_digest: string;
	assets: Record<string, { sha256: string; size_bytes: number }>;
	index?: { sha256: string; size_bytes: number; gzip_sha256: string; gzip_size_bytes: number };
}
export function terraformHash(data: Uint8Array | string): string {
	return createHash("sha256").update(data).digest("hex");
}
function safePath(value: string): void {
	if (
		!/^docs\/(?:[A-Za-z0-9_~-]+\/)*[A-Za-z0-9_.~-]+\.md$/.test(value) ||
		value.split("/").some(v => v === "." || v === "..")
	)
		throw new Error(`Unsafe Terraform document path: ${value}`);
}
export function parseTerraformPin(value: unknown): TerraformPin {
	const pin = value as TerraformPin;
	if (
		pin?.schema_version !== 1 ||
		pin.source_repository !== "f5-sales-demo/terraform-provider-xcsh" ||
		!/^v\d+\.\d+\.\d+$/.test(pin.provider_version) ||
		pin.release_tag !== `docs-${pin.provider_version}` ||
		!/^[a-f0-9]{40}$/.test(pin.source_commit) ||
		!/^[a-f0-9]{64}$/.test(pin.receipt_sha256) ||
		!Number.isSafeInteger(pin.document_count) ||
		pin.document_count < 1 ||
		pin.document_count > 100000 ||
		!/^sha256:[a-f0-9]{64}$/.test(pin.provider_schema_digest) ||
		!/^sha256:[a-f0-9]{64}$/.test(pin.spec_pin_digest)
	)
		throw new Error("Invalid Terraform snapshot identity");
	if (
		Object.keys(pin.assets ?? {})
			.sort()
			.join() !== [...TERRAFORM_ASSETS].sort().join()
	)
		throw new Error("Invalid Terraform snapshot assets");
	for (const asset of Object.values(pin.assets)) {
		if (
			!/^[a-f0-9]{64}$/.test(asset.sha256) ||
			!Number.isSafeInteger(asset.size_bytes) ||
			asset.size_bytes <= 0 ||
			asset.size_bytes > 512 * 1024 * 1024
		)
			throw new Error("Invalid Terraform asset hash or size");
	}
	if (pin.assets["publication.json"]!.sha256 !== pin.receipt_sha256) throw new Error("Terraform receipt pin mismatch");
	if (
		pin.index &&
		(!/^[a-f0-9]{64}$/.test(pin.index.sha256) ||
			!/^[a-f0-9]{64}$/.test(pin.index.gzip_sha256) ||
			!Number.isSafeInteger(pin.index.size_bytes) ||
			pin.index.size_bytes < 1 ||
			pin.index.size_bytes > 2 * 1024 * 1024 * 1024 ||
			!Number.isSafeInteger(pin.index.gzip_size_bytes) ||
			pin.index.gzip_size_bytes < 1 ||
			pin.index.gzip_size_bytes > 512 * 1024 * 1024)
	)
		throw new Error("Invalid Terraform index pin");
	return pin;
}
function splitMarkdown(markdown: string): { body: string; enriched: unknown } {
	if (!markdown.startsWith("---\n")) return { body: markdown, enriched: undefined };
	const end = markdown.indexOf("\n---\n", 4);
	if (end < 0) throw new Error("Unterminated Terraform frontmatter");
	const header = parseYaml(markdown.slice(4, end));
	return { body: markdown.slice(end + 5).replace(/^\n/, ""), enriched: header?.xcsh_docs };
}

export async function verifyTerraformSnapshot(root: string, inputPin: TerraformPin): Promise<TerraformDocument[]> {
	const pin = parseTerraformPin(inputPin);
	const files = new Map<string, Buffer>();
	for (const name of TERRAFORM_ASSETS) {
		const data = await readFile(path.join(root, name));
		const expected = pin.assets[name]!;
		if (data.length !== expected.size_bytes || terraformHash(data) !== expected.sha256)
			throw new Error(`Terraform asset verification failed: ${name}`);
		files.set(name, data);
	}
	const receipt = JSON.parse(files.get("publication.json")!.toString());
	for (const key of [
		"schema_version",
		"source_repository",
		"provider_version",
		"release_tag",
		"source_commit",
		"document_count",
		"provider_schema_digest",
		"spec_pin_digest",
	] as const)
		if (receipt[key] !== pin[key]) throw new Error(`Terraform receipt identity mismatch: ${key}`);
	for (const name of ["manifest.json", "terraform-docs.tar.gz"]) {
		if (JSON.stringify(receipt.assets[name]) !== JSON.stringify(pin.assets[name])) {
			if (
				receipt.assets[name]?.sha256 !== pin.assets[name]!.sha256 ||
				receipt.assets[name]?.size_bytes !== pin.assets[name]!.size_bytes
			)
				throw new Error(`Terraform receipt asset mismatch: ${name}`);
		}
	}
	const sums = files.get("SHA256SUMS")!.toString().trim().split("\n");
	if (sums.length !== 3) throw new Error("Invalid Terraform checksum list");
	const seenSums = new Set<string>();
	for (const line of sums) {
		const match = /^([a-f0-9]{64}) {2}(manifest.json|publication.json|terraform-docs.tar.gz)$/.exec(line);
		if (!match || seenSums.has(match[2]!) || pin.assets[match[2]!]!.sha256 !== match[1])
			throw new Error("Terraform checksum mismatch");
		seenSums.add(match[2]!);
	}
	const manifest = JSON.parse(files.get("manifest.json")!.toString());
	for (const key of [
		"schema_version",
		"source_repository",
		"provider_version",
		"source_commit",
		"document_count",
		"provider_schema_digest",
		"spec_pin_digest",
	] as const)
		if (manifest[key] !== pin[key]) throw new Error(`Terraform manifest identity mismatch: ${key}`);
	if (!Array.isArray(manifest.documents) || manifest.documents.length !== pin.document_count)
		throw new Error("Terraform document count mismatch");
	const expected = new Map<string, Omit<TerraformDocument, "markdown" | "body">>();
	for (const entry of manifest.documents) {
		safePath(entry.path);
		if (expected.has(entry.path)) throw new Error("Duplicate Terraform document path");
		if (
			!Number.isSafeInteger(entry.size_bytes) ||
			entry.size_bytes < 1 ||
			entry.size_bytes > 4 * 1024 * 1024 ||
			!/^[a-f0-9]{64}$/.test(entry.sha256) ||
			!/^[a-f0-9]{64}$/.test(entry.body_sha256)
		)
			throw new Error("Invalid Terraform document hash or size");
		const m = entry.metadata as TerraformMetadata;
		if (
			!m ||
			m.path !== entry.path ||
			typeof m.id !== "string" ||
			typeof m.canonical_id !== "string" ||
			![m.provider_type, m.provider_name, m.role].every(v => typeof v === "string" && /^[A-Za-z0-9_-]+$/.test(v)) ||
			typeof m.summary !== "string" ||
			!Array.isArray(m.schema_path) ||
			!Array.isArray(m.aliases) ||
			!Array.isArray(m.child_ids) ||
			![...m.schema_path, ...m.aliases, ...m.child_ids].every(v => typeof v === "string") ||
			(m.parent_id !== null && typeof m.parent_id !== "string") ||
			(m.projection_part !== undefined && (!Number.isSafeInteger(m.projection_part) || m.projection_part < 1))
		)
			throw new Error("Invalid Terraform metadata");
		expected.set(entry.path, entry);
	}
	const documents: TerraformDocument[] = [];
	const extract = tar.extract();
	let failure: Error | undefined;
	let total = 0;
	extract.on("entry", (header, stream, next) => {
		const chunks: Buffer[] = [];
		try {
			safePath(header.name);
			const entry = expected.get(header.name);
			if (header.type !== "file" || !entry || header.size !== entry.size_bytes)
				throw new Error("Unexpected Terraform archive member");
			expected.delete(header.name);
		} catch (error) {
			failure = error as Error;
		}
		let bytes = 0;
		stream.on("data", chunk => {
			bytes += chunk.length;
			total += chunk.length;
			if (bytes > 4 * 1024 * 1024 || total > 1024 * 1024 * 1024)
				failure = new Error("Terraform archive exceeds size limit");
			if (!failure) chunks.push(Buffer.from(chunk));
		});
		stream.on("end", () => {
			if (!failure) {
				try {
					const data = Buffer.concat(chunks);
					const entry = manifest.documents.find((d: TerraformDocument) => d.path === header.name);
					if (terraformHash(data) !== entry.sha256) throw new Error("Terraform document hash mismatch");
					const markdown = new TextDecoder("utf-8", { fatal: true }).decode(data);
					const parsed = splitMarkdown(markdown);
					if (terraformHash(parsed.body) !== entry.body_sha256) throw new Error("Terraform body hash mismatch");
					if (parsed.enriched) {
						const m = parsed.enriched as TerraformMetadata;
						if (
							m.body_sha256 !== `sha256:${entry.body_sha256}` ||
							m.body_bytes !== Buffer.byteLength(parsed.body) ||
							JSON.stringify(Object.entries(m).sort()) !== JSON.stringify(Object.entries(entry.metadata).sort())
						)
							throw new Error("Terraform enriched metadata mismatch");
					}
					documents.push({ ...entry, markdown, body: parsed.body });
				} catch (error) {
					failure = error as Error;
				}
			}
			next();
		});
	});
	const archive = gunzipSync(files.get("terraform-docs.tar.gz")!, { maxOutputLength: 1024 * 1024 * 1024 });
	await new Promise<void>((resolve, reject) => {
		extract.on("finish", resolve);
		extract.on("error", reject);
		Readable.from(archive).pipe(extract);
	});
	if (failure) throw failure;
	if (expected.size || documents.length !== pin.document_count) throw new Error("Missing Terraform archive documents");
	const ids = new Set(documents.flatMap(d => [d.metadata.id, d.metadata.canonical_id]));
	for (const d of documents)
		for (const id of [d.metadata.parent_id, ...d.metadata.child_ids])
			if (id && !ids.has(id)) throw new Error(`Missing Terraform relationship target: ${id}`);
	const paths = new Map(documents.map(d => [d.path, d]));
	for (const document of documents) {
		const prose = document.body.replace(/```[^\n]*\n[\s\S]*?```/g, "");
		for (const match of prose.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
			const href = match[1]!;
			if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href) || href.startsWith("//")) continue;
			const [target, anchor] = href.split("#");
			if (target && !target.endsWith(".md")) continue;
			const resolved = target
				? path.posix.normalize(path.posix.join(path.posix.dirname(document.path), target))
				: document.path;
			safePath(resolved);
			const destination = paths.get(resolved);
			if (!destination) throw new Error(`Missing Terraform internal link: ${resolved}`);
			if (anchor && !terraformPassages(destination.body).some(p => p.anchor === anchor))
				throw new Error(`Missing Terraform internal anchor: ${resolved}#${anchor}`);
		}
	}
	return documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function terraformPassages(body: string, complete = true): DocumentationPassage[] {
	const lines = body.split("\n");
	const starts: Array<{ line: number; level: number; anchor: string; heading: string }> = [];
	const occurrences = new Map<string, number>();
	let fence: string | undefined;
	for (const [line, value] of lines.entries()) {
		const marker = /^\s*(`{3,}|~{3,})/.exec(value)?.[1];
		if (marker) {
			if (!fence) fence = marker[0];
			else if (fence === marker[0]) fence = undefined;
			continue;
		}
		if (fence) continue;
		const explicit = /^\s*<a\s+(?:id|name)=["']([^"']+)["']\s*><\/a>\s*$/.exec(value);
		if (explicit) {
			let nextLine = line + 1;
			while (nextLine < lines.length && !lines[nextLine]!.trim()) nextLine++;
			const next = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[nextLine] ?? "");
			starts.push({ line, level: next?.[1]?.length ?? 3, anchor: explicit[1]!, heading: next?.[2] ?? explicit[1]! });
		}
		const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(value);
		if (heading)
			starts.push({
				line,
				level: heading[1]!.length,
				anchor: githubHeadingAnchor(heading[2]!, occurrences),
				heading: heading[2]!,
			});
	}
	const anchors = new Set<string>();
	return starts
		.filter(s => {
			if (anchors.has(s.anchor)) return false;
			anchors.add(s.anchor);
			return true;
		})
		.map((start, ordinal) => {
			const end =
				starts.find(
					s =>
						s.line > start.line &&
						!(
							/^\s*<a\s/.test(lines[start.line]!) &&
							s.heading === start.heading &&
							lines.slice(start.line + 1, s.line).every(value => !value.trim())
						) &&
						(!complete || s.level <= start.level),
				)?.line ?? lines.length;
			return {
				anchor: start.anchor,
				heading: start.heading,
				markdown: lines.slice(start.line, end).join("\n"),
				ordinal,
			};
		})
		.concat(starts.length ? [] : [{ anchor: "document", heading: "Document", markdown: body, ordinal: 0 }]);
}

export async function buildTerraformIndex(
	documents: TerraformDocument[],
	pin: TerraformPin,
	output: string,
): Promise<void> {
	await rm(output, { force: true });
	const store = await createStore({
		dbPath: output,
		config: { collections: { terraform: { path: "/terraform", pattern: "**/*.md" } } },
	});
	try {
		const db = store.internal.db;
		db.exec(
			"CREATE TABLE terraform_documents(path TEXT PRIMARY KEY, metadata TEXT NOT NULL, markdown TEXT NOT NULL); CREATE TABLE terraform_passages(qmd_path TEXT PRIMARY KEY,path TEXT NOT NULL,anchor TEXT NOT NULL,heading TEXT NOT NULL,ordinal INTEGER NOT NULL); CREATE TABLE terraform_provenance(pin TEXT NOT NULL)",
		);
		const { index: _index, ...snapshotPin } = pin;
		db.prepare("INSERT INTO terraform_provenance VALUES (?)").run(JSON.stringify(snapshotPin));
		const insertDoc = db.prepare("INSERT INTO terraform_documents VALUES (?,?,?)");
		const insertPassage = db.prepare("INSERT INTO terraform_passages VALUES (?,?,?,?,?)");
		db.transaction(() => {
			for (const d of documents) {
				insertDoc.run(d.path, JSON.stringify(d.metadata), d.markdown);
				const m = d.metadata;
				const title = [
					m.provider_name,
					`xcsh_${m.provider_name}`,
					m.provider_type,
					m.role,
					m.schema_path.join(" "),
					m.summary,
					...m.aliases,
				].join(" ");
				for (const p of terraformPassages(d.body, false)) {
					const qmdPath = `${d.path}#${p.anchor}`;
					const hash = terraformHash(`${d.sha256}\0${p.anchor}\0${p.markdown}`);
					store.internal.insertContent(hash, p.markdown, "2000-01-01T00:00:00Z");
					store.internal.insertDocument(
						"terraform",
						qmdPath,
						`${title} ${p.heading}`,
						hash,
						"2000-01-01T00:00:00Z",
						"2000-01-01T00:00:00Z",
					);
					insertPassage.run(qmdPath, d.path, p.anchor, p.heading, p.ordinal);
				}
			}
		})();
		db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; VACUUM");
	} finally {
		await store.close();
	}
}

export interface TerraformEmbeddedAssets {
	indexGzipPath: string;
	pin: TerraformPin & { index: NonNullable<TerraformPin["index"]> };
}
export class TerraformDocumentationRepository {
	#ready: Promise<Database> | undefined;
	constructor(
		readonly assets: TerraformEmbeddedAssets,
		readonly cacheRoot: string,
	) {}
	async database(): Promise<Database> {
		if (!this.#ready)
			this.#ready = this.#materialize().catch(error => {
				this.#ready = undefined;
				throw error;
			});
		return this.#ready;
	}
	async #materialize(): Promise<Database> {
		const pin = parseTerraformPin(this.assets.pin);
		const expected = this.assets.pin.index;
		await mkdir(this.cacheRoot, { recursive: true });
		const file = path.join(this.cacheRoot, `${expected.sha256}.sqlite`);
		let cached: Buffer | undefined;
		try {
			cached = await readFile(file);
		} catch {}
		if (!cached || cached.length !== expected.size_bytes || terraformHash(cached) !== expected.sha256) {
			const compressed = await Bun.file(this.assets.indexGzipPath).bytes();
			if (compressed.length !== expected.gzip_size_bytes || terraformHash(compressed) !== expected.gzip_sha256)
				throw new Error("Terraform compressed index verification failed");
			const bytes = gunzipSync(compressed, { maxOutputLength: expected.size_bytes });
			if (bytes.length !== expected.size_bytes || terraformHash(bytes) !== expected.sha256)
				throw new Error("Terraform index verification failed");
			const temporary = `${file}.${randomUUID()}.tmp`;
			try {
				await writeFile(temporary, bytes, { mode: 0o600 });
				await rename(temporary, file);
			} finally {
				await rm(temporary, { force: true });
			}
		}
		const db = new Database(file, { readonly: true });
		const row = db.query("SELECT pin FROM terraform_provenance").get() as { pin: string };
		const indexed = JSON.parse(row.pin);
		if (indexed.source_commit !== pin.source_commit || indexed.receipt_sha256 !== pin.receipt_sha256) {
			db.close();
			throw new Error("Terraform index provenance mismatch");
		}
		return db;
	}
	async resolve(url: InternalUrl): Promise<InternalResource> {
		const allowed = new Set(["search", "provider_type", "provider_name", "role", "limit"]);
		for (const key of url.searchParams.keys())
			if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1)
				throw new Error(`Invalid Terraform parameter: ${key}`);
		const rawPath = url.rawPathname ?? url.pathname;
		if (
			/%(?:2f|5c|2e)/i.test(rawPath) ||
			rawPath.includes("\\") ||
			rawPath.split("/").some(v => v === "." || v === "..")
		)
			throw new Error("Unsafe Terraform request path");
		const documentPath = rawPath.replace(/^\//, "");
		const search = url.searchParams.get("search")?.trim();
		if (search !== undefined && (!search || Buffer.byteLength(search) > 512))
			throw new Error("Terraform search must contain 1 to 512 UTF-8 bytes");
		const limitValue = url.searchParams.get("limit");
		if (limitValue !== null && !/^(?:[1-9]|10)$/.test(limitValue))
			throw new Error("Terraform search limit must be 1 to 10");
		if (!search && url.searchParams.size) throw new Error("Terraform filters and limit require search");
		if (documentPath && search) throw new Error("Terraform search requires the inventory path");
		if (documentPath) safePath(documentPath);
		const db = await this.database();
		const provenance = `Provider: ${this.assets.pin.provider_version}\nSnapshot: ${this.assets.pin.release_tag}\nCommit: ${this.assets.pin.source_commit}\nReceipt SHA-256: ${this.assets.pin.receipt_sha256}`;
		let content: string;
		if (documentPath) {
			const row = db.query("SELECT * FROM terraform_documents WHERE path=?").get(documentPath) as {
				metadata: string;
				markdown: string;
				body: string;
			} | null;
			if (!row) throw new Error(`Terraform document not found: ${documentPath}`);
			const anchor = decodeURIComponent(url.hash.slice(1));
			const passage = anchor
				? terraformPassages(splitMarkdown(row.markdown).body).find(p => p.anchor === anchor)
				: undefined;
			if (anchor && !passage) throw new Error(`Terraform anchor not found: ${anchor}`);
			content = `${provenance}\nDocument: ${documentPath}\nMetadata: ${row.metadata}\nPinned source: https://github.com/${this.assets.pin.source_repository}/blob/${this.assets.pin.source_commit}/${documentPath}\n\n${rewriteTerraformLinks(passage?.markdown ?? row.markdown, documentPath)}`;
		} else if (search) {
			const clauses = ["documents_fts MATCH ?", "d.active=1"];
			const terms = search.normalize("NFKC").match(/[\p{L}\p{N}_]+/gu) ?? [];
			const args: Array<string | number> = [terms.map(v => `"${v}"*`).join(" OR ")];
			for (const key of ["provider_type", "provider_name", "role"]) {
				const value = url.searchParams.get(key);
				if (value === null) continue;
				if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`Invalid Terraform filter: ${key}`);
				clauses.push(`json_extract(td.metadata,'$.${key}')=?`);
				args.push(value);
			}
			if (!url.searchParams.has("provider_name")) {
				const names = db
					.query(
						"SELECT DISTINCT json_extract(metadata,'$.provider_name') name FROM terraform_documents ORDER BY length(name) DESC,name",
					)
					.all() as Array<{ name: string }>;
				const normalized = search.toLowerCase().replace(/[_-]+/g, " ");
				const owner = names.find(
					({ name }) =>
						name !== "xcsh" &&
						(name.includes("_") || normalized.trim() === name) &&
						normalized.includes(name.replace(/_/g, " ").replace(/loadbalancer/g, "load balancer")),
				);
				if (owner) {
					clauses.push("json_extract(td.metadata,'$.provider_name')=?");
					args.push(owner.name);
				}
			}
			args.push(limitValue === null ? 5 : Number(limitValue));
			const rows = terms.length
				? (db
						.query(`WITH scored AS (
				SELECT td.path,td.metadata,p.anchor,p.heading,c.doc AS markdown,p.ordinal,
				ABS(bm25(documents_fts,1.5,4.0,1.0))/(1+ABS(bm25(documents_fts,1.5,4.0,1.0))) score
				FROM documents_fts JOIN documents d ON d.id=documents_fts.rowid
				JOIN content c ON c.hash=d.hash JOIN terraform_passages p ON p.qmd_path=d.path JOIN terraform_documents td ON td.path=p.path
				WHERE ${clauses.join(" AND ")}), ranked AS (
				SELECT *,ROW_NUMBER() OVER(PARTITION BY path ORDER BY score DESC,ordinal ASC) rank FROM scored)
				SELECT * FROM ranked WHERE rank=1 ORDER BY score DESC,path COLLATE BINARY,ordinal LIMIT ?`)
						.all(...args) as Array<{
						path: string;
						metadata: string;
						anchor: string;
						heading: string;
						markdown: string;
						score: number;
					}>)
				: [];
			content = `${provenance}\n\n# Terraform search: ${search}\n\n${
				rows.length
					? rows
							.map(r => {
								const m = JSON.parse(r.metadata) as TerraformMetadata;
								return `## ${m.provider_type}: xcsh_${m.provider_name} — ${m.role}\nDocument: ${r.path}\nIdentity: ${m.id}\nCanonical: ${m.canonical_id}\nSchema path: ${m.schema_path.join(".") || "root"}\nScore: ${Number(r.score.toFixed(12))}\nRead: xcsh://terraform-documentation/${r.path}#${r.anchor}\n\n${r.markdown.replace(/\s+/g, " ").slice(0, 600)}`;
							})
							.join("\n\n")
					: "No results."
			}`;
		} else {
			const values = (key: string) =>
				(
					db
						.query(
							`SELECT DISTINCT json_extract(metadata,'$.${key}') value FROM terraform_documents ORDER BY value COLLATE BINARY`,
						)
						.all() as Array<{ value: string }>
				)
					.map(r => r.value)
					.join(", ");
			content = `${provenance}\n\n# Offline Terraform documentation\n${this.assets.pin.document_count} Markdown documents from docs/.\n\nSearch: xcsh://terraform-documentation/?search=<query>&provider_type=<type>&provider_name=<name>&role=<role>&limit=<1-10>\nDefault limit: five. Filters combine with AND.\nprovider_type: ${values("provider_type")}\nprovider_name: ${values("provider_name")}\nrole: ${values("role")}\n\nExact reads: xcsh://terraform-documentation/docs/<path>.md#<heading-or-explicit-anchor>\nGuidance reflects documented schema validation; it is not live-apply evidence.`;
		}
		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content),
			sourcePath: url.href,
		};
	}
}

export function rewriteTerraformLinks(markdown: string, source: string): string {
	return markdown.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (whole, title: string, href: string) => {
		if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href) || href.startsWith("//")) return whole;
		const [target, anchor] = href.split("#");
		const resolved = target ? path.posix.normalize(path.posix.join(path.posix.dirname(source), target)) : source;
		try {
			safePath(resolved);
		} catch {
			return whole;
		}
		return `[${title}](xcsh://terraform-documentation/${resolved}${anchor ? `#${anchor}` : ""})`;
	});
}
