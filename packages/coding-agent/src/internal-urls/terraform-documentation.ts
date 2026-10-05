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
import { lookupTerraformAlias } from "./terraform-alias-lookup";
import { terraformBranchChoices, terraformLeadingRoleHint, terraformRoleChoices } from "./terraform-branch-choices";
import { verifiedChoiceEdges } from "./terraform-choice-edges";
import { terraformChoiceResponse } from "./terraform-choice-response";
import { terraformConflictContext } from "./terraform-conflict-context";
import { type EnumValidatorEvidence, validateEnumEvidence } from "./terraform-enum-evidence";
import { matchesFieldAccess, requestedFieldAccess } from "./terraform-field-access";
import { interpretTerraformLifecycle } from "./terraform-lifecycle";
import {
	populatePropertyIndex,
	searchPropertyEnumValue,
	searchPropertyIndex,
	validatePropertyIndex,
} from "./terraform-property-index";
import {
	propertyRequestedBlockText,
	propertyRequestedText,
	propertyRequestsBlock,
	propertyRequestsCollection,
	propertyWithoutBreadcrumbs,
	propertyWithoutSingleSchemaScope,
} from "./terraform-property-ranking";
import { refineRankedProperty } from "./terraform-property-refinement";
import { type RankedProperty, selectPropertyDestination } from "./terraform-property-selection";
import {
	referenceOwnershipHint,
	type TerraformReferenceIdentity,
	validateReferenceIdentity,
} from "./terraform-reference-evidence";
import { lookupReferenceMembers, referenceScopeDestination } from "./terraform-reference-index";
import { filterSecretRepresentation } from "./terraform-secret-representation";
import { resolveIndexedTask } from "./terraform-task-route";
import type { InternalResource, InternalUrl } from "./types";

export const TERRAFORM_ASSETS = ["terraform-docs.tar.gz", "manifest.json", "publication.json", "SHA256SUMS"] as const;
export const TERRAFORM_EXTENDED_ASSETS = [
	...TERRAFORM_ASSETS,
	"canonical-documentation.tar.gz",
	"canonical-manifest.json",
	"registry-documentation.tar.gz",
	"registry-manifest.json",
	"registry-projection-manifest.json",
] as const;
export function terraformAssetEnvelope(names: string[]): boolean {
	const sorted = names.toSorted().join();
	return sorted === [...TERRAFORM_ASSETS].sort().join() || sorted === [...TERRAFORM_EXTENDED_ASSETS].sort().join();
}
export interface TerraformRelationship {
	type: "requires" | "conflicts" | "choice" | "advisory";
	target_id: string;
	anchor: string;
	enforcement: string;
	source: string;
	group?: string;
}
export interface TerraformSection {
	reference_identity?: TerraformReferenceIdentity;
	enum_validators?: EnumValidatorEvidence[];
	enum_extraction_complete?: boolean;
	schema_path: string[];
	document_id: string;
	anchor: string;
	description: string;
	aliases: string[];
	relationships: TerraformRelationship[];
	flags: string[];
	type?: string;
	nesting?: string | null;
	min_items?: number | null;
	max_items?: number | null;
}
export interface TerraformMetadata {
	retrieval_version?: number;
	category?: string | null;
	capabilities?: string[];
	tasks?: string[];
	sections?: TerraformSection[];
	relationships?: TerraformRelationship[];
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
export function validateTerraformRetrievalMetadata(m: TerraformMetadata): void {
	if (m.retrieval_version === undefined) return;
	if (
		m.retrieval_version !== 1 ||
		(m.category !== null && (typeof m.category !== "string" || !/^[a-z][a-z0-9-]*$/.test(m.category))) ||
		!Array.isArray(m.capabilities) ||
		!m.capabilities.every(v => typeof v === "string" && /^[a-z][a-z0-9.-]*$/.test(v)) ||
		!Array.isArray(m.tasks) ||
		!m.tasks.every(v => ["configuration", "troubleshooting", "import", "authentication", "lifecycle"].includes(v)) ||
		!Array.isArray(m.sections) ||
		!Array.isArray(m.relationships)
	)
		throw new Error("Invalid Terraform retrieval metadata");
	for (const section of m.sections)
		if (
			!section ||
			!Array.isArray(section.schema_path) ||
			!section.schema_path.every(v => typeof v === "string") ||
			typeof section.document_id !== "string" ||
			typeof section.anchor !== "string" ||
			typeof section.description !== "string" ||
			!Array.isArray(section.aliases) ||
			!section.aliases.every(v => typeof v === "string") ||
			!Array.isArray(section.flags) ||
			!section.flags.every(flag =>
				["required", "optional", "computed", "sensitive", "deprecated", "write_only"].includes(flag),
			) ||
			(section.type != null &&
				!["bool", "string", "number", "object", "list", "set", "map"].includes(section.type)) ||
			(section.nesting != null && !["single", "list", "set", "map"].includes(section.nesting)) ||
			[section.min_items, section.max_items].some(
				value => value != null && (!Number.isSafeInteger(value) || value < 0),
			) ||
			(section.min_items != null && section.max_items != null && section.min_items > section.max_items) ||
			!Array.isArray(section.relationships)
		)
			throw new Error("Invalid Terraform retrieval section");
	for (const section of m.sections) {
		if (section.reference_identity !== undefined)
			validateReferenceIdentity(section.reference_identity, section.schema_path);
		if (section.enum_validators === undefined && section.enum_extraction_complete === undefined) continue;
		if (typeof section.enum_extraction_complete !== "boolean" || !Array.isArray(section.enum_validators))
			throw new Error("Invalid Terraform enum coverage");
		const evidence = validateEnumEvidence(section.enum_validators);
		if (section.enum_extraction_complete && evidence.some(rule => !rule.complete))
			throw new Error("Unresolved Terraform enum with complete coverage");
	}
	for (const r of [...m.relationships, ...m.sections.flatMap(v => v.relationships)])
		if (
			!r ||
			!["requires", "conflicts", "choice", "advisory"].includes(r.type) ||
			typeof r.target_id !== "string" ||
			typeof r.anchor !== "string" ||
			typeof r.source !== "string" ||
			!["provider-schema", "upstream-advisory", "provider-choice"].includes(r.enforcement) ||
			(r.enforcement === "upstream-advisory" && r.type !== "advisory") ||
			(r.type === "advisory" && r.enforcement !== "upstream-advisory") ||
			(r.enforcement === "provider-choice" && !["choice", "conflicts"].includes(r.type))
		)
			throw new Error("Invalid Terraform typed relationship");
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
	retrieval_metadata_version?: 1;
	schema_version: 2;
	source_root: "documentation";
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
		!/^documentation\/(?:[A-Za-z0-9_~-]+\/)*[A-Za-z0-9_.~-]+\.md$/.test(value) ||
		value.split("/").some(v => v === "." || v === "..")
	)
		throw new Error(`Unsafe Terraform document path: ${value}`);
}
export function parseTerraformPin(value: unknown): TerraformPin {
	const pin = value as TerraformPin;
	if (
		pin?.schema_version !== 2 ||
		(pin.retrieval_metadata_version !== undefined && pin.retrieval_metadata_version !== 1) ||
		pin.source_root !== "documentation" ||
		pin.source_repository !== "f5-sales-demo/terraform-provider-xcsh" ||
		!/^v\d+\.\d+\.\d+$/.test(pin.provider_version) ||
		pin.release_tag !== `documentation-${pin.provider_version}` ||
		!/^[a-f0-9]{40}$/.test(pin.source_commit) ||
		!/^[a-f0-9]{64}$/.test(pin.receipt_sha256) ||
		!Number.isSafeInteger(pin.document_count) ||
		pin.document_count < 1 ||
		pin.document_count > 100000 ||
		!/^sha256:[a-f0-9]{64}$/.test(pin.provider_schema_digest) ||
		!/^sha256:[a-f0-9]{64}$/.test(pin.spec_pin_digest)
	)
		throw new Error("Invalid Terraform snapshot identity");
	if (!terraformAssetEnvelope(Object.keys(pin.assets ?? {}))) throw new Error("Invalid Terraform snapshot assets");
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
	for (const name of Object.keys(pin.assets)) {
		const data = await readFile(path.join(root, name));
		const expected = pin.assets[name]!;
		if (data.length !== expected.size_bytes || terraformHash(data) !== expected.sha256)
			throw new Error(`Terraform asset verification failed: ${name}`);
		files.set(name, data);
	}
	const receipt = JSON.parse(files.get("publication.json")!.toString());
	for (const key of [
		"schema_version",
		"source_root",
		"source_repository",
		"provider_version",
		"release_tag",
		"source_commit",
		"document_count",
		"provider_schema_digest",
		"spec_pin_digest",
	] as const)
		if (receipt[key] !== pin[key]) throw new Error(`Terraform receipt identity mismatch: ${key}`);
	if (!terraformAssetEnvelope([...Object.keys(receipt.assets ?? {}), "publication.json", "SHA256SUMS"]))
		throw new Error("Invalid Terraform receipt asset membership");
	for (const name of Object.keys(pin.assets).filter(n => n !== "publication.json" && n !== "SHA256SUMS")) {
		if (JSON.stringify(receipt.assets[name]) !== JSON.stringify(pin.assets[name])) {
			if (
				receipt.assets[name]?.sha256 !== pin.assets[name]!.sha256 ||
				receipt.assets[name]?.size_bytes !== pin.assets[name]!.size_bytes
			)
				throw new Error(`Terraform receipt asset mismatch: ${name}`);
		}
	}
	const sums = files.get("SHA256SUMS")!.toString().trim().split("\n");
	if (sums.length !== Object.keys(pin.assets).length - 1) throw new Error("Invalid Terraform checksum list");
	const seenSums = new Set<string>();
	for (const line of sums) {
		const match = /^([a-f0-9]{64}) {2}([A-Za-z0-9_.-]+)$/.exec(line);
		if (
			!match ||
			match[2] === "SHA256SUMS" ||
			!pin.assets[match[2]!] ||
			seenSums.has(match[2]!) ||
			pin.assets[match[2]!]!.sha256 !== match[1]
		)
			throw new Error("Terraform checksum mismatch");
		seenSums.add(match[2]!);
	}
	const manifest = JSON.parse(files.get("manifest.json")!.toString());
	if (
		pin.retrieval_metadata_version !== undefined &&
		(receipt.retrieval_metadata_version !== pin.retrieval_metadata_version ||
			manifest.retrieval_metadata_version !== pin.retrieval_metadata_version)
	)
		throw new Error("Terraform retrieval metadata version mismatch");
	for (const key of [
		"schema_version",
		"source_root",
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
		validateTerraformRetrievalMetadata(m);
		if (pin.retrieval_metadata_version !== undefined && m.retrieval_version !== pin.retrieval_metadata_version)
			throw new Error("Terraform document retrieval metadata version mismatch");
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
							JSON.stringify(Object.entries({ ...m, canonical_id: m.canonical_id ?? m.id }).sort()) !==
								JSON.stringify(Object.entries(entry.metadata).sort())
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
			const destination = terraformLinkPath(match[1]!, document.path);
			if (!destination) continue;
			const target = paths.get(destination.path);
			if (!target) throw new Error(`Missing Terraform internal link: ${destination.path}`);
			if (destination.anchor && !terraformPassages(target.body).some(p => p.anchor === destination.anchor))
				throw new Error(`Missing Terraform internal anchor: ${destination.path}#${destination.anchor}`);
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

function canonicalTerraformJson(value: unknown): string {
	const normalize = (item: unknown): unknown => {
		if (Array.isArray(item)) return item.map(normalize);
		if (item !== null && typeof item === "object")
			return Object.fromEntries(
				Object.entries(item)
					.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
					.map(([key, child]) => [key, normalize(child)]),
			);
		return item;
	};
	return JSON.stringify(normalize(value));
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
		db.exec(`
            CREATE TABLE terraform_documents(path TEXT PRIMARY KEY,metadata TEXT NOT NULL,markdown TEXT NOT NULL,
              id TEXT NOT NULL,canonical_id TEXT NOT NULL,parent_id TEXT,summary TEXT NOT NULL,
              provider_type TEXT NOT NULL,provider_name TEXT NOT NULL,role TEXT NOT NULL);
            CREATE INDEX terraform_identity ON terraform_documents(id);
            CREATE INDEX terraform_parent ON terraform_documents(parent_id);
            CREATE INDEX terraform_provider ON terraform_documents(provider_type,provider_name,role);
            CREATE TABLE terraform_facets(path TEXT NOT NULL,facet TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(facet,value,path));
            CREATE INDEX terraform_facets_path ON terraform_facets(path,facet,value);
            CREATE TABLE terraform_passages(qmd_path TEXT PRIMARY KEY,path TEXT NOT NULL,anchor TEXT NOT NULL,heading TEXT NOT NULL,ordinal INTEGER NOT NULL);
            CREATE INDEX terraform_passage_path ON terraform_passages(path,ordinal);
            CREATE TABLE terraform_sections(path TEXT NOT NULL,anchor TEXT NOT NULL,heading TEXT NOT NULL,ordinal INTEGER NOT NULL,markdown TEXT NOT NULL,context_markdown TEXT NOT NULL,context_alias INTEGER NOT NULL,PRIMARY KEY(path,anchor));
            CREATE INDEX terraform_section_order ON terraform_sections(path,ordinal);
            CREATE TABLE terraform_relationships(path TEXT NOT NULL,anchor TEXT NOT NULL,type TEXT NOT NULL,target_path TEXT NOT NULL,target_anchor TEXT NOT NULL,enforcement TEXT NOT NULL,source TEXT NOT NULL,choice_group TEXT);
            CREATE INDEX terraform_relationship_source ON terraform_relationships(path,anchor);
            CREATE TABLE terraform_destinations(provider_type TEXT NOT NULL,provider_name TEXT NOT NULL,schema_path TEXT NOT NULL,phrase TEXT NOT NULL,path TEXT NOT NULL,anchor TEXT NOT NULL,description TEXT NOT NULL,PRIMARY KEY(provider_type,provider_name,schema_path));
            CREATE TABLE terraform_aliases(provider_type TEXT NOT NULL,provider_name TEXT NOT NULL,alias TEXT NOT NULL,path TEXT NOT NULL,anchor TEXT NOT NULL,PRIMARY KEY(provider_type,provider_name,alias,path,anchor));
            CREATE INDEX terraform_alias_lookup ON terraform_aliases(provider_name,provider_type,alias);
            CREATE INDEX terraform_destination_lookup ON terraform_destinations(provider_name,provider_type,phrase);
            CREATE TABLE terraform_provenance(pin TEXT NOT NULL);
        `);
		const { index: _index, ...snapshotPin } = pin;
		db.prepare("INSERT INTO terraform_provenance VALUES (?)").run(canonicalTerraformJson(snapshotPin));
		const insertDoc = db.prepare("INSERT INTO terraform_documents VALUES (?,?,?,?,?,?,?,?,?,?)");
		const insertPassage = db.prepare("INSERT INTO terraform_passages VALUES (?,?,?,?,?)");
		const insertSection = db.prepare("INSERT INTO terraform_sections VALUES (?,?,?,?,?,?,?)");
		const insertFacet = db.prepare("INSERT OR IGNORE INTO terraform_facets VALUES (?,?,?)");
		const insertAlias = db.prepare("INSERT OR IGNORE INTO terraform_aliases VALUES (?,?,?,?,?)");
		const insertDestination = db.prepare("INSERT OR IGNORE INTO terraform_destinations VALUES (?,?,?,?,?,?,?)");
		const insertRelationship = db.prepare("INSERT INTO terraform_relationships VALUES (?,?,?,?,?,?,?,?)");
		const identities = new Map(documents.map(d => [d.metadata.id, d.path]));
		const anchors = new Map(documents.map(d => [d.path, new Set(terraformPassages(d.body).map(p => p.anchor))]));
		db.transaction(() => {
			for (const d of documents) {
				const m = d.metadata;
				validateTerraformRetrievalMetadata(m);
				if (m.retrieval_version !== undefined && m.retrieval_version !== 1)
					throw new Error("Unsupported Terraform retrieval metadata version");
				insertDoc.run(
					d.path,
					JSON.stringify(m),
					d.markdown,
					m.id,
					m.canonical_id,
					m.parent_id,
					m.summary,
					m.provider_type,
					m.provider_name,
					m.role,
				);
				for (const [facet, values] of Object.entries({
					provider_type: [m.provider_type],
					provider_name: [m.provider_name],
					role: [m.role],
					category: m.category ? [m.category] : [],
					capability: m.capabilities ?? [],
					task: m.tasks ?? [],
				})) {
					for (const value of values) {
						if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+$/.test(value))
							throw new Error("Invalid Terraform facet value");
						insertFacet.run(d.path, facet, value);
					}
				}
				if (m.role === "properties")
					for (const alias of m.aliases)
						insertAlias.run(m.provider_type, m.provider_name, alias, d.path, "section");
				for (const section of m.sections ?? []) {
					const target = identities.get(section.document_id);
					if (!target || !anchors.get(target)?.has(section.anchor))
						throw new Error("Missing Terraform property destination");
					for (const alias of section.aliases)
						insertAlias.run(m.provider_type, m.provider_name, alias, target, section.anchor);
					insertDestination.run(
						m.provider_type,
						m.provider_name,
						section.schema_path.join("."),
						section.schema_path.join(" ").replaceAll("_", " "),
						target,
						section.anchor,
						section.description,
					);
				}
				const localSections = new Map(terraformPassages(d.body, false).map(p => [p.anchor, p.markdown]));
				const completeSections = terraformPassages(d.body);
				for (const p of completeSections)
					insertSection.run(
						d.path,
						p.anchor,
						p.heading,
						p.ordinal,
						"",
						localSections.get(p.anchor) ?? p.markdown,
						completeSections[p.ordinal - 1]?.heading === p.heading &&
							/^(schema-|section$)/.test(completeSections[p.ordinal - 1]!.anchor)
							? 1
							: 0,
					);
				const relations = [
					{ anchor: "section", values: m.relationships ?? [] },
					...(m.sections ?? [])
						.filter(v => v.document_id === m.id)
						.map(v => ({ anchor: v.anchor, values: v.relationships })),
				];
				for (const relation of relations)
					for (const r of relation.values) {
						const target = identities.get(r.target_id);
						if (!target || (r.anchor && !anchors.get(target)?.has(r.anchor)))
							throw new Error("Missing Terraform typed relationship destination");
						insertRelationship.run(
							d.path,
							relation.anchor,
							r.type,
							target,
							r.anchor,
							r.enforcement,
							r.source,
							r.group ?? null,
						);
					}
				for (const edge of verifiedChoiceEdges(m.relationships ?? [])) {
					const source = identities.get(edge.source_id),
						target = identities.get(edge.target_id);
					if (
						!source ||
						!target ||
						!anchors.get(source)?.has(edge.source_anchor) ||
						!anchors.get(target)?.has(edge.anchor)
					)
						throw new Error("Missing Terraform exact choice destination");
					insertRelationship.run(
						source,
						edge.source_anchor,
						edge.type,
						target,
						edge.anchor,
						edge.enforcement,
						edge.source,
						edge.group ?? null,
					);
				}
				const title = [
					m.provider_name,
					m.provider_name.replaceAll("_", " "),
					"xcsh",
					{
						resources: "resource",
						"data-sources": "data source",
						actions: "action",
						"ephemeral-resources": "ephemeral resource",
					}[m.provider_type] ?? m.provider_type,
					`xcsh_${m.provider_name}`,
					m.provider_type,
					m.role,
					m.schema_path.join(" "),
					m.schema_path.join(" ").replaceAll("_", " "),
					m.summary,
					...m.aliases,
					...(m.capabilities ?? []),
					...(m.tasks ?? []),
				].join(" ");
				const passages = m.role === "navigation" ? [] : terraformPassages(d.body, false);
				for (const p of passages) {
					if (
						m.role === "properties" &&
						p.ordinal === 0 &&
						p.anchor !== "section" &&
						passages.some(section => section.anchor === "section")
					)
						continue;
					// Adjacent explicit anchors and headings share one searchable passage.
					const previous = passages[p.ordinal - 1];
					if (previous && previous.heading === p.heading && /^(schema-|section$)/.test(previous.anchor)) continue;
					if (/^(Breadcrumbs|All schema paths|Next pages|Direct properties)$/i.test(p.heading)) continue;
					const section = m.sections?.find(v => v.document_id === m.id && v.anchor === p.anchor);
					const passageContent =
						m.role === "properties" ? p.markdown.replace(/^([`~]{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "") : p.markdown;
					const content = passageContent
						.replace(/^Breadcrumbs:[\s\S]*?(?=^##|^<a)/m, "")
						.replace(/^\|.*\|\s*$/gm, "");
					const qmdPath = `${d.path}#${p.anchor}`;
					const hash = terraformHash(`${d.sha256}\0${p.anchor}\0${content}`);
					store.internal.insertContent(hash, content, "2000-01-01T00:00:00Z");
					store.internal.insertDocument(
						"terraform",
						qmdPath,
						`${title} ${p.heading} ${section?.description ?? ""} ${section?.aliases.join(" ") ?? ""}`,
						hash,
						"2000-01-01T00:00:00Z",
						"2000-01-01T00:00:00Z",
					);
					insertPassage.run(qmdPath, d.path, p.anchor, p.heading, p.ordinal);
				}
			}
		})();
		// Bundled tables share the outer index digest; only a separate side index can bind a source digest.
		populatePropertyIndex(db, { sourceCommit: pin.source_commit, sourceIndexSha256: "" });
		db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; VACUUM");
	} finally {
		await store.close();
	}
}

export interface TerraformEmbeddedAssets {
	indexGzipPath: string;
	pin: TerraformPin & { index: NonNullable<TerraformPin["index"]> };
}
const TERRAFORM_QUERY_STOPWORDS = new Set(
	"a an the and how where what do does i we you my me our your can could should would please help tell know put already have that to for of in on with using use configure configuration setup set up terraform provider documentation document documented field fields subsection is are be begin need needs explain about please existing".split(
		" ",
	),
);
const TERRAFORM_QUERY_VARIANTS: Record<string, string> = {
	succeeded: "success",
	successful: "success",
	succeeds: "success",
	failed: "failure",
	fails: "failure",
	cert: "certificate",
	certs: "certificate",
};

export function terraformNamedChoice(
	query: string,
	choices: readonly { schema_path: string[]; aliases: string[] }[],
): number | undefined {
	const normalize = (text: string) =>
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
	const question = ` ${normalize(query)} `;
	const identifiers: string[] = query.toLowerCase().match(/[a-z][a-z0-9_]*/g) ?? [];
	const mentioned = choices.flatMap((choice, index) =>
		identifiers.includes(choice.schema_path.at(-1) ?? "") ? [index] : [],
	);
	if (mentioned.length > 1 && /\band\b|\bor\b|\bcompare\b/i.test(query)) return undefined;
	const exact = mentioned.filter(index => !["https", "http"].includes(choices[index]!.schema_path.at(-1) ?? ""));
	if (exact.length === 1) return exact[0];
	if (exact.length > 1) return undefined;
	const phrases = choices.map(
		choice =>
			new Set(
				[choice.schema_path.at(-1) ?? "", ...choice.aliases]
					.map(normalize)
					.filter(
						term => Boolean(term) && !["tls encryption", "tls certificates", "https", "http"].includes(term),
					),
			),
	);
	const matches = phrases.map((terms, index) =>
		[...terms].some(
			term =>
				question.includes(` ${term} `) &&
				!phrases.some((other, otherIndex) => otherIndex !== index && other.has(term)),
		),
	);
	const indices = matches.flatMap((matched, index) => (matched ? [index] : []));
	return indices.length === 1 ? indices[0] : undefined;
}

export function terraformAliasQueryText(query: string): string {
	return ` ${query
		.toLowerCase()
		.replace(/\btimestamp\b/g, "time")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()} `;
}

export function rankTerraformDirectProperties(
	query: string,
	parentPath: readonly string[],
	sections: readonly TerraformSection[],
): TerraformSection[] {
	if (/\b(?:block|object|schema path)\b/i.test(query) && !/\b(?:field|attribute|property)\b/i.test(query)) return [];
	if (propertyRequestsCollection(query)) return [];
	const terms = (value: string) => [
		...new Set(
			(
				value
					.toLowerCase()
					.replace(/autonomous system number/g, "asn")
					.match(/[a-z0-9]+/g) ?? []
			)
				.filter(term => !TERRAFORM_QUERY_STOPWORDS.has(term))
				.map(
					term =>
						({
							redirection: "redirect",
							redirecting: "redirect",
							listening: "listen",
							listener: "listen",
							addresses: "address",
							addr: "address",
						})[term] ?? term,
				),
		),
	];
	const requested = terms(query);
	const parentTerms = new Set(terms(parentPath.join(" ")));
	const ranked = sections
		.filter(
			section =>
				section.schema_path.length === parentPath.length + 1 &&
				parentPath.every((part, index) => section.schema_path[index] === part),
		)
		.map(section => {
			const leaf = new Set(terms(section.schema_path.at(-1)!));
			const description = new Set(terms(section.description));
			const score = requested.reduce(
				(total, term) => total + (leaf.has(term) ? 4 : description.has(term) && !parentTerms.has(term) ? 1 : 0),
				0,
			);
			return { section, score: score + (leaf.has("asn") && /autonomous system number/i.test(query) ? 8 : 0) };
		})
		.filter(row => row.score >= 4)
		.sort(
			(a, b) =>
				b.score - a.score ||
				(a.section.anchor < b.section.anchor ? -1 : a.section.anchor > b.section.anchor ? 1 : 0),
		);
	if (!ranked[0] || (ranked[1] && ranked[0].score < ranked[1].score + 2)) return [];
	return [ranked[0].section];
}

export function scoreTerraformAliasContext(
	query: string,
	schemaPath: string,
	providerTerms: readonly string[],
): number {
	const words = (query.toLowerCase().match(/[a-z0-9_]+/g) ?? []).flatMap(word => word.split("_"));
	const provider = new Set(providerTerms);
	const ignored = new Set([
		"xcsh",
		"resource",
		"data",
		"source",
		"refer",
		"which",
		"lists",
		"for",
		"terraform",
		"where",
		"do",
		"i",
		"the",
		"in",
		"is",
		"documented",
	]);
	const variants: Record<string, string> = {
		succeeded: "success",
		successful: "success",
		succeeds: "success",
		failed: "failure",
		stateful: "stateful",
		kubernetes: "k8s",
	};
	const terms = [
		...new Set(words.filter(term => !provider.has(term) && !ignored.has(term)).map(term => variants[term] ?? term)),
	];
	const pathTerms = new Set(schemaPath.split(/[._]+/));
	let score = terms.filter(term => pathTerms.has(term)).length * 20 - schemaPath.split(".").length * 3;
	const identifiers = (query.match(/[a-z][a-z0-9]*_[a-z0-9_]+/gi) ?? []).filter(term => !term.startsWith("xcsh_"));
	const leaf = schemaPath.split(".").at(-1);
	if (identifiers.some(term => term.toLowerCase() === leaf)) score += 80;
	if (terms.includes("success") && pathTerms.has("failure") && !pathTerms.has("success")) score -= 40;
	if (terms.includes("failure") && pathTerms.has("success") && !pathTerms.has("failure")) score -= 40;
	return score;
}

export function terraformProviderSetupDestination(query: string): string | undefined {
	if (/\b(?:aws|azure|gcp|google|oci|oracle)\s+(?:terraform\s+)?provider\b/i.test(query)) return undefined;
	query = query.replace(
		/\bso\s+(?:the\s+)?xcsh\s+provider\s+can\s+(?:manage|read|configure)\s+(?:resources|data sources|actions)\b/gi,
		" xcsh provider ",
	);
	const env: string[] = query.match(/\bXCSH_[A-Z0-9_]+\b/g) ?? [];
	if (
		/\bprovider\b/i.test(query) &&
		/\b(?:authentication|authenticate|credentials?|environment|argument reference)\b/i.test(query) &&
		env.length &&
		!/\b(?:resources?|data[ -]sources?|actions?|ephemeral|decryption|secret store|store provider|storage provider)\b/i.test(
			query,
		)
	) {
		const anchors = new Set<string>();
		if (/\bpem\b/i.test(query)) anchors.add("option-3-pem-certificate-authentication");
		if (/\bp12\b|\bpkcs[ #_-]?12\b/i.test(query)) anchors.add("option-2-p12-certificate-authentication");
		if (/\bapi[ -]token\b/i.test(query)) anchors.add("option-1-api-token-authentication");
		if (env.includes("XCSH_API_TOKEN")) anchors.add("option-1-api-token-authentication");
		if (env.some(name => ["XCSH_P12_FILE", "XCSH_P12_PASSWORD"].includes(name)))
			anchors.add("option-2-p12-certificate-authentication");
		if (env.some(name => ["XCSH_CERT", "XCSH_KEY", "XCSH_CACERT"].includes(name)))
			anchors.add("option-3-pem-certificate-authentication");
		return anchors.size === 1 ? [...anchors][0] : "authentication-options";
	}
	query = query.replace(
		/\bXCSH_(?:API_URL|API_TOKEN|P12_FILE|P12_PASSWORD|CACERT|CERT|KEY)\b/g,
		" environment variable ",
	);
	if (/\b(?:decryption|secret store|store provider|storage provider)\b/i.test(query)) return undefined;
	if (/\b(?:resources?|data[ -]sources?|actions?|ephemeral)\b/i.test(query)) return undefined;
	if (/\bxcsh_(?!provider\b)[a-z][a-z0-9_]*\b/i.test(query)) return undefined;
	if (!/\bprovider\b/i.test(query) || !/\bauthenticat(?:ion|e|ing)\b|\bcredentials?\b|\bapi[ _-]token\b/i.test(query))
		return undefined;
	if (/\benvironment\b.*\bvariables?\b/i.test(query)) return "argument-reference";
	const methods = [
		{ present: /\bapi[ _-]token\b/i.test(query), anchor: "option-1-api-token-authentication" },
		{
			present: /\bp12(?:_file|_password)?\b|\bpkcs[ #_-]?12\b/i.test(query),
			anchor: "option-2-p12-certificate-authentication",
		},
		{ present: /\bpem\b/i.test(query), anchor: "option-3-pem-certificate-authentication" },
	].filter(method => method.present);
	return methods.length === 1 ? methods[0]!.anchor : "authentication-options";
}

export function terraformTaskDestination(query: string): { role: string; anchor?: string } | undefined {
	if (
		/\b(?:draft|write|generate)\s+hcl\b/i.test(query) &&
		/\b(?:resource|ephemeral)\s+"?xcsh_[a-z0-9_]+/i.test(query) &&
		!/\b(?:snippet|fragment)\b/i.test(query)
	)
		return { role: "fundamentals", anchor: "minimal-configuration" };
	if (propertyRequestedBlockText(query) && !/\b(?:example|usage)\b/i.test(query)) return undefined;
	if (
		propertyRequestedText(query) &&
		/`[a-z][a-z0-9_]*`/.test(query) &&
		!/\b(?:import|example|usage|guidance|minimal|root)\b/i.test(query)
	)
		return undefined;
	if (/\bimport(?:s|ing)?\b|\badopt\b.*\bstate\b/i.test(query)) return { role: "import" };
	const valueLookup =
		/\b(?:find|locate|point me to)\b|\bwhere\s+(?:is|are|do I put)\b/i.test(query) &&
		!/\b(?:resource|data[ -]source|action)\b\s+(?:is\s+)?(?:documented|defined|specification)\b|\b(?:minimal|root)\s+configuration\b|\b(?:example|usage|guidance)\b/i.test(
			query,
		);
	if (
		valueLookup ||
		(/\bwhere\s+(?:is|are)\s+(?!(?:(?:an?|the)\s+)?(?:resource\b|data[ -]source\b|action\b|xcsh_))/i.test(query) &&
			propertyRequestedText(query))
	)
		return undefined;
	if (
		/\bresource\b.*\b(?:documented|specification)\b/i.test(query) &&
		!/\b(?:attributes?|fields?|property|properties|parameters?|schema path)\b/i.test(query)
	)
		return { role: "fundamentals", anchor: "minimal-configuration" };
	const fieldRequest =
		Boolean(propertyRequestedText(query)) ||
		(/\bxcsh_[a-z0-9_]+\b/i.test(query) &&
			/\b(?:read|fetch|retrieve|lookup|specify|configure|computed)\b.*\b(?:name|id|number|process|token|address|port|status|value|parameter)\b/i.test(
				query,
			)) ||
		/\b(?:fields?|attributes?|property|properties|parameters?|arguments?|flags?|schema path|match rules|inside|under)\b|\b(?:declare|configure|specify|set)\b.*\b(?:address|port|name|value|prefix|status|header|timeout|number)\b/i.test(
			query,
		);
	const scopedLookup =
		/\b(?:query(?:ing)?|look(?:ing)? up|read(?:ing)?|inspect(?:ing)?)\b[^,]*\bdata[ -]source\b[^,]*,\s*(?:where|which|what)\b/i.test(
			query,
		);
	if (!fieldRequest && !scopedLookup) {
		if (
			/\bdata[ -]source\b/i.test(query) &&
			/\b(?:query(?:ing)?|look(?:ing)? up|lookup|read(?:ing)?|inspect(?:ing)?)\b/i.test(query)
		)
			return { role: "fundamentals", anchor: "root-configuration" };
		if (
			/\b(?:declare|defined|definition)\b.*\b(?:xcsh_[a-z0-9_]+|resource|policy)\b|\b(?:xcsh_[a-z0-9_]+|resource)\b.*\b(?:defined|definition)\b/i.test(
				query,
			)
		)
			return { role: "fundamentals", anchor: "minimal-configuration" };
		if (/\bephemeral\b/i.test(query) && /\b(?:obtain|use|declare|create)\b/i.test(query))
			return { role: "fundamentals", anchor: "minimal-configuration" };
	}

	if (
		/\baction\b/i.test(query) &&
		!/\b(?:fields?|attributes?|(?:property|properties)|ids?|namespace|parameters?|arguments?|flags?)\b/i.test(
			query,
		) &&
		/\b(?:which|declare|invoke|trigger|where|how)\b/i.test(query)
	)
		return { role: "fundamentals", anchor: "minimal-configuration" };

	if (/\bminimal\s+configuration\b|\bminimal\s+(?:hcl\s+)?example\b/i.test(query))
		return { role: "fundamentals", anchor: "minimal-configuration" };
	if (/\broot\s+configuration\b/i.test(query)) return { role: "fundamentals", anchor: "root-configuration" };
	if (!/\b(?:field|attribute|property|properties|parameter|schema path)\b/i.test(query)) {
		if (
			/\b(?:which|what)\s+(?:the\s+)?resource\b.*\b(?:manage|manages|create|creates|represent|represents|provide|provides)\b|\bresource\b.*\b(?:documented|specification)\b/i.test(
				query,
			)
		)
			return { role: "fundamentals", anchor: "minimal-configuration" };
		if (
			/\b(?:which|what)\s+data[ -]source\b.*\b(?:read|reads|query|queries|provide|provides|inspect|inspects)\b|\bdata[ -]source\b.*\bdocumented\b/i.test(
				query,
			)
		)
			return { role: "fundamentals", anchor: "root-configuration" };
	}

	if (
		/\b(?:timeouts?|operation(?:s)? wait limits|wait limits.*operations)\b/i.test(query) &&
		/\b(?:duration.*format|how.*(?:written|configure)|customize|expose.*wait limits)\b/i.test(query) &&
		!/\b(?:field|attribute|property|parameter|schema|create|delete|read|update|connection|idle|handshake)\b/i.test(
			query,
		)
	)
		return { role: "timeouts" };
	if (
		/\btimeouts?\b/i.test(query) &&
		/\blifecycle\b|\busage\b|\bduration string format\b|\bguidance\b/i.test(query) &&
		!/\battributes?\b|\bschema\b|\b(?:property|properties)\b/i.test(query)
	)
		return { role: "timeouts" };
	return undefined;
}

export function terraformKnownQueryTerms(query: string, exists: (term: string) => boolean): string[] {
	return query.split(" AND ").filter(term => exists(term));
}

const TERRAFORM_IDENTITY_TERMS: Record<string, string> = {
	remove: "delete",
	removes: "delete",
	upgrades: "upgrade",
	deleting: "delete",
	removal: "delete",
	modify: "edit",
	modifies: "edit",
	modifying: "edit",
	generate: "add",
	creates: "add",
	create: "add",
	attach: "add",
	adding: "add",
	termination: "terminate",
	terminating: "terminate",
	invalidate: "terminate",
	subscription: "subscribe",
	subscribing: "subscribe",
	unsubscribes: "unsubscribe",
	unsubscribing: "unsubscribe",
	synchronization: "synchronize",
	synchronizing: "synchronize",
	sync: "synchronize",
	signatures: "signature",
	cryptokeys: "cryptokey",
	keys: "key",
	nodes: "node",
};
export function rankTerraformProviderNames(
	query: string,
	names: readonly string[],
): Array<{ name: string; score: number }> {
	const normalize = (value: string) =>
		(
			value
				.toLowerCase()
				.replace(/operating[ -]system/g, "os")
				.replace(/software/g, "sw")
				.match(/[a-z0-9]+/g) ?? []
		).map(term => TERRAFORM_IDENTITY_TERMS[term] ?? term);
	const terms = new Set(normalize(query));
	const batch = /\bmultiple\b|\bbulk\b|\bbatch\b/.test(query) || /\bsessions\b/.test(query);
	const single = /\bsingle\b|\bone\b|\bspecific\b/.test(query);
	return names
		.map(name => {
			const tokens = normalize(name.replaceAll("_", " "));
			let score = tokens.filter(term => terms.has(term)).length * 10;
			const operation = tokens.at(-1);
			if (operation && terms.has(operation)) score += 20;
			if (name.includes("sessions")) score += batch ? 15 : single ? -15 : 0;
			else if (name.includes("session")) score += single ? 15 : batch ? -15 : 0;
			return { name, score };
		})
		.filter(row => row.score >= 20)
		.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function terraformTimeoutOperations(query: string): string[] {
	return interpretTerraformLifecycle(query)?.operations ?? [];
}

export function terraformProviderMention(search: string, names: readonly string[]): string | undefined {
	const exact = [
		...new Set([...search.matchAll(/\bxcsh_([a-z][a-z0-9_]*)\b/gi)].map(match => match[1]!.toLowerCase())),
	];
	if (exact.length === 1 && names.includes(exact[0]!)) return exact[0];
	if (exact.length > 1) return undefined;
	search = propertyWithoutSingleSchemaScope(propertyWithoutBreadcrumbs(search));
	const literalNames = names.filter(name => name.includes("_") && new RegExp(`\\b${name}\\b`, "i").test(search));
	if (literalNames.length === 1) return literalNames[0];
	if (literalNames.length > 1) return undefined;

	if (/\ballowlists?\b|\bnetwork[ -]list\b/i.test(search) && !/\b(?:compare|versus|vs|between)\b/i.test(search)) {
		const families: Array<[string, RegExp]> = [
			["network_regional_edges", /\bregional[ -]edges?\b/i],
			["network_cdn", /\bcdn\b/i],
			["network_bot_defense", /\bbot[ -]defense\b/i],
			["network_customer_edge_egress", /\bcustomer[ -]edge\b.*\begress\b|\bsecure[ -]mesh\s+v2\b/i],
			["network_data_intelligence", /\bdata[ -]intelligence\b/i],
			["network_secondary_dns_zone_transfer", /\bsecondary[ -]dns\b/i],
			["network_dnslb_health_checks", /\bdns[ -]load[ -]balancer\b.*\bhealth[ -]checks?\b/i],
		];
		const aliasQuery = search.replace(/\((?:such as\b|e\.g\.|for example\b)[^)]*\)/gi, "");
		const requestedAllowlist =
			/\ballowlists?\s+data[ -]source\b|\bdata[ -]source\b[^.!?;]*\ballowlists?\b|\ballowlist\s+(?:discovery|input|output)\b/i.test(
				aliasQuery,
			);
		const negated = /\b(?:not|no|never|without|excluding)\b/i.test(aliasQuery);
		const matching =
			requestedAllowlist && !negated
				? families.filter(([name, expression]) => names.includes(name) && expression.test(aliasQuery))
				: [];
		if (matching.length === 1) return matching[0]![0];
		if (matching.length > 1) return undefined;
	}

	const normalize = (value: string) =>
		value
			.toLowerCase()
			.replace(/load[ _-]+balancer/g, "loadbalancer")
			.replace(/health[ -]+check/g, "healthcheck")
			.replace(/application[ _-]+firewall/g, "app firewall")
			.replace(/transit[ _-]+gateway/g, "tgw")
			.replace(/kubernetes/g, "k8s")
			.replace(/big[ _-]+ip/g, "bigip")
			.replace(/secure[ _-]+mesh/g, "securemesh")
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
	const providerSearch = search
		.replace(/\bsecure[ _-]*mesh\s+v2\b/gi, "securemesh site v2")
		.split(/[,;!?]|\.(?=\s)/)
		.map(clause => {
			const intent = clause.split(
				/\b(?:to|for)\s+(?:support|handle|serve|provide|configure|enable)\b|\bfor\s+http\s+health\s+checks?\b/i,
			)[0]!;
			return /\bhttp\b/i.test(intent) && !/\b(?:not|no|without)\s+(?:using\s+)?http\b/i.test(intent)
				? clause.replace(/\bapplication[ -]+balancer\b/gi, "HTTP load balancer")
				: clause;
		})
		.join(" ");
	const query = ` ${normalize(providerSearch)} `;
	const explicitFieldLabel = /\b(?:field|attribute|property|parameter|argument|flag)\s*:\s*`[a-z][a-z0-9_]*`/i.test(
		search,
	);
	const found = names
		.filter(name => query.includes(` ${normalize(name)} `))
		.filter(name => {
			if (!explicitFieldLabel || name.includes("_")) return true;
			const phrase = normalize(name);
			return (
				new RegExp(
					`\\b(?:${phrase} (?:managed )?(?:resource|data source|action)|(?:resource|data source|action) ${phrase})\\b`,
				).test(query) || new RegExp(`\\b(?:on|in|under) (?:a |an |the |my |our )${phrase}\\b`).test(query)
			);
		})
		.filter(name => {
			if (!["endpoint", "authentication", "setup", "xcsh"].includes(name)) return true;
			const phrase = normalize(name);
			return ["resource", "data source", "action"].some(role => query.includes(` ${phrase} ${role} `));
		})
		.sort((a, b) => normalize(b).length - normalize(a).length || (a < b ? -1 : a > b ? 1 : 0));
	if (found.length > 1) {
		if (/\b(?:compare|versus|vs|between)\b/.test(query)) return undefined;
		const declaredOwners = found.filter(name => {
			const phrase = normalize(name);
			return (
				query.includes(` ${phrase} resource `) ||
				query.includes(` ${phrase} managed resource `) ||
				["stateless", "stateful", "stateless service", "stateful service"].some(modifier => {
					const ownership = ` ${phrase} ${modifier} resource `;
					const affirmative = search
						.replace(/\((?:such as\b|e\.g\.|for example\b)[^)]*\)/gi, "")
						.replace(/\be\.g\./gi, "for example");
					return affirmative
						.split(/[.!?;,]+/)
						.some(
							clause =>
								` ${normalize(clause)} `.includes(ownership) &&
								!/\b(?:not|no|never|without|excluding|unrelated|for example|such as|instead of|rather than)\b/i.test(
									clause,
								),
						);
				}) ||
				query.includes(` ${phrase} data source `) ||
				query.includes(` ${phrase} action `)
			);
		});
		if (declaredOwners.length === 1) return declaredOwners[0];
		const onOwners = found.filter(name =>
			new RegExp(`\\b(on (?:a |an |the |our |my ))(?:managed |stateful )?${normalize(name)}\\b`).test(query),
		);
		if (onOwners.length === 1) return onOwners[0];
		const owners = found.filter(name => {
			const phrase = normalize(name);
			return new RegExp(
				`\\b(?:(?:in|under) (?:a |an |the |our |my )?|on (?:a |an |the |our |my ))(?:managed |stateful )?${phrase}\\b`,
			).test(query);
		});
		if (owners.length === 1) return owners[0];
	}
	return found[0] && (!found[1] || normalize(found[0]).length > normalize(found[1]).length) ? found[0] : undefined;
}

export function terraformQueryIdentity(search: string): { providerPhrase?: string; providerType?: string } {
	const ordinaryRoleText = search.replace(/\bephemeral\s+resource\b/gi, "ephemeral");
	const exact = [...search.matchAll(/\bxcsh_([a-z][a-z0-9_]*)\b/gi)];
	const names = [...new Set(exact.map(match => match[1]!.toLowerCase()))];
	const explicitRoles = new Set<string>();
	if (/\b(?:data[ -]source|data\.xcsh_[a-z0-9_]+)\b/i.test(search)) explicitRoles.add("data-sources");
	if (/\bephemeral(?: resource)?\b|\bephemeral\.xcsh_[a-z0-9_]+\b/i.test(search))
		explicitRoles.add("ephemeral-resources");
	if (
		/\bresource\b|\bresource\.xcsh_[a-z0-9_]+\b|\b(?:managed|existing)\s+(?:xcsh_[a-z0-9_]+\s+)?resource\b|\bxcsh_[a-z0-9_]+\s+resource\b|\bmanaged\s+xcsh_[a-z0-9_]+\b/i.test(
			ordinaryRoleText,
		)
	)
		explicitRoles.add("resources");
	if (/\b(?:action\s+xcsh_[a-z0-9_]+|xcsh_[a-z0-9_]+\s+action)\b/i.test(search)) explicitRoles.add("actions");
	const competingRoles =
		/\b(?:read|retrieve|inspect|lookup|query|check)\b[^.!?]*\bor\b[^.!?]*\b(?:declare|define|configure|specify|set|create)\b|\b(?:declare|define|configure|specify|set|create)\b[^.!?]*\bor\b[^.!?]*\b(?:read|retrieve|inspect|lookup|query|check)\b/i.test(
			search,
		) ||
		/\b(?:configure|set|specify)\b.*\bor\b.*\b(?:reference|inspect|read)\b|\bresource\b.*\bdata[ -]source\b|\bdata[ -]source\b.*\bresource\b/i.test(
			search,
		);
	const documentationLookup =
		/\b(?:read|look up|lookup|inspect|query)\b.*\b(?:documentation|docs|schema|examples?|reference)\b/i.test(
			search,
		) && !/\bexisting\b/i.test(search);
	const providerType =
		explicitRoles.size > 1
			? undefined
			: explicitRoles.size === 1
				? [...explicitRoles][0]
				: competingRoles || documentationLookup
					? undefined
					: /\bephemeral(?: resource)?\b/i.test(search)
						? "ephemeral-resources"
						: /\bdata[ -]source\b/i.test(search)
							? "data-sources"
							: /\baction\b/i.test(search)
								? "actions"
								: /\bresource\b/i.test(search) ||
										/\b(?:draft|generate|write)\b.*\b(?:hcl|terraform)\b/i.test(search) ||
										/\b(?:(?:declare|declaring)|(?:define|defining)|suppl(?:y|ying)|(?:specify|specifying)|configur(?:e|ing)|provision(?:ing)?|creat(?:e|ing)|deploy(?:ing)?|set|setting(?=\s+(?:up|the|a|an|my|our|your)\b)|enabl(?:e|ing)|(?:disable|disabling)|attach(?:ing)?|register(?:ing)?)\b/i.test(
											search,
										)
									? "resources"
									: /\b(?:inspect|query|look up|lookup|read existing|retrieve existing)\b/i.test(search)
										? "data-sources"
										: undefined;
	return {
		...(names.length === 1 ? { providerPhrase: names[0]!.replaceAll("_", " ") } : {}),
		...(providerType ? { providerType } : {}),
	};
}

export function terraformSearchQuery(query: string): string {
	const terms =
		query
			.normalize("NFKC")
			.toLowerCase()
			.replace(/http load balancer/g, "http_loadbalancer")
			.replace(/cdn load balancer/g, "cdn_loadbalancer")
			.match(/[\p{L}\p{N}_]+/gu) ?? [];
	return [...new Set(terms.filter(term => !TERRAFORM_QUERY_STOPWORDS.has(term)))]
		.map(term => {
			const variant = TERRAFORM_QUERY_VARIANTS[term];
			return variant ? `("${term}"* OR "${variant}"*)` : `"${term}"*`;
		})
		.join(" AND ");
}

export function terraformScopedSearchQuery(query: string, providerName: string | undefined): string {
	if (!providerName) return terraformSearchQuery(query);
	const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const identity = providerName.replaceAll("_", " ").replace(/loadbalancer/g, "load balancer");
	const namePattern = new RegExp(
		`\\b(?:xcsh_${escapePattern(providerName)}|${escapePattern(providerName)}|${escapePattern(identity)})\\b`,
		"gi",
	);
	return terraformSearchQuery(query.replace(namePattern, " ").replace(/\bresources?\b/gi, " "));
}

export function boundedTerraformResponse(prefix: string, entries: string[], budget: number, continuation = ""): string {
	const suffix = continuation ? `\n\n${continuation}` : "";
	if (Buffer.byteLength(prefix + suffix) > budget) throw new Error("Terraform response envelope exceeds budget");
	const parts = [prefix];
	for (const entry of entries) {
		if (Buffer.byteLength(`${parts.join("\n\n")}\n\n${entry}${suffix}`) > budget) break;
		parts.push(entry);
	}
	return parts.join("\n\n") + suffix;
}

export function selectTerraformCandidate(
	candidates: Array<{ path: string; anchor: string; metadata: TerraformMetadata; ranking: number }>,
	broadened: boolean,
	query?: string,
): "leaf" | "choices" {
	const destinations = new Map<string, (typeof candidates)[number]>();
	for (const candidate of candidates) {
		const key = `${candidate.metadata.provider_type}:${candidate.path}#${candidate.anchor}`;
		const previous = destinations.get(key);
		if (!previous || candidate.ranking > previous.ranking) destinations.set(key, candidate);
	}
	candidates = [...destinations.values()].sort(
		(a, b) =>
			b.ranking - a.ranking ||
			(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
			(a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
	);
	const first = candidates[0];
	if (
		!first ||
		broadened ||
		(!/^(schema-|section$)/.test(first.anchor) &&
			!["import", "timeouts", "lifecycle"].includes(first.metadata.role) &&
			!(
				first.metadata.provider_type === "provider" &&
				[
					"authentication-options",
					"argument-reference",
					"option-1-api-token-authentication",
					"option-2-p12-certificate-authentication",
					"option-3-pem-certificate-authentication",
				].includes(first.anchor)
			) &&
			!(
				first.metadata.role === "fundamentals" &&
				["minimal-configuration", "root-configuration"].includes(first.anchor)
			))
	)
		return "choices";
	if (query) {
		const normalize = (value: string) =>
			value
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, " ")
				.trim();
		const question = ` ${normalize(query)} `;
		const firstPath = first.anchor.startsWith("schema-")
			? first.anchor.slice(7).split("--")
			: first.metadata.schema_path;
		for (const other of candidates.slice(1)) {
			if (
				first.metadata.provider_name !== other.metadata.provider_name ||
				first.metadata.provider_type !== other.metadata.provider_type
			)
				continue;
			const otherPath = other.anchor.startsWith("schema-")
				? other.anchor.slice(7).split("--")
				: other.metadata.schema_path;
			if (firstPath.at(-1) !== otherPath.at(-1) || !firstPath.length || !otherPath.length) continue;
			const sharedSuffix: string[] = [];
			let a = firstPath.length - 1,
				b = otherPath.length - 1;
			while (a >= 0 && b >= 0 && firstPath[a] === otherPath[b]) {
				sharedSuffix.unshift(firstPath[a]!);
				a--;
				b--;
			}
			if (a < 0 && b < 0) continue;
			// Require a phrase identifying the branch, not merely its common leaf.
			const firstBranch = firstPath.slice(0, a + 1).filter(segment => !otherPath.includes(segment));

			const named = (segments: string[]) =>
				segments.some(segment => {
					const phrase = normalize(segment);
					const singular = phrase
						.split(" ")
						.map(word =>
							word.endsWith("s") &&
							word.length > 4 &&
							!["https", "status"].includes(word) &&
							!word.endsWith("ss")
								? word.slice(0, -1)
								: word,
						)
						.join(" ");
					return question.includes(` ${phrase} `) || question.includes(` ${singular} `);
				});
			if (!named(firstBranch)) return "choices";
		}
	}
	const second = candidates[1];
	// A missing provider role or competing TLS/choice branch needs real clarification.
	if (
		candidates
			.slice(1)
			.some(
				candidate =>
					first.metadata.provider_name === candidate.metadata.provider_name &&
					first.metadata.provider_type !== candidate.metadata.provider_type,
			)
	)
		return "choices";
	if (second && first.ranking < second.ranking * 1.3 && !(first.path === second.path && first.anchor === "section"))
		return "choices";
	return "leaf";
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
		try {
			validatePropertyIndex(db, { sourceCommit: pin.source_commit, sourceIndexSha256: "" });
		} catch (error) {
			db.close();
			throw error;
		}
		return db;
	}
	#trace(db: Database, documentPath: string): string {
		const nodes = db
			.query(`WITH RECURSIVE trail(path,id,parent,summary,depth) AS (
          SELECT path,id,parent_id,summary,0 FROM terraform_documents WHERE path=?
          UNION ALL SELECT d.path,d.id,d.parent_id,d.summary,t.depth+1 FROM terraform_documents d JOIN trail t ON d.id=t.parent WHERE t.depth<20
        ) SELECT path,summary FROM trail ORDER BY depth DESC LIMIT 21`)
			.all(documentPath) as Array<{ path: string; summary: string }>;
		return `Documentation trail:\n${nodes.map(n => `- [${n.summary}](xcsh://terraform-documentation/${n.path})`).join("\n")}`;
	}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const allowed = new Set([
			"search",
			"enum_value",
			"alias",
			"reference_scope",
			"reference_member",
			"choice_after",
			"provider_type",
			"provider_name",
			"role",
			"category",
			"capability",
			"task",
			"limit",
			"node",
			"facet",
			"cursor",
			"view",
			"after",
		]);
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
		const exactAlias = url.searchParams.get("alias");
		if (
			exactAlias !== null &&
			(!exactAlias.trim() ||
				Buffer.byteLength(exactAlias) > 512 ||
				!url.searchParams.has("provider_type") ||
				!url.searchParams.has("provider_name") ||
				["search", "enum_value", "reference_scope", "reference_member", "cursor", "facet", "view", "after"].some(
					key => url.searchParams.has(key),
				) ||
				documentPath ||
				url.hash)
		)
			throw new Error("Invalid explicit alias discovery");
		const enumValue = url.searchParams.get("enum_value");
		if (
			enumValue !== null &&
			(!enumValue ||
				Buffer.byteLength(enumValue) > 512 ||
				!url.searchParams.has("provider_type") ||
				!url.searchParams.has("provider_name") ||
				["search", "reference_scope", "reference_member", "choice_after", "cursor", "facet", "view", "after"].some(
					key => url.searchParams.has(key),
				) ||
				documentPath ||
				url.hash)
		)
			throw new Error("Invalid explicit enum discovery");
		const referenceScope = url.searchParams.get("reference_scope");
		const referenceMember = url.searchParams.get("reference_member");
		if (referenceMember !== null && referenceScope === null)
			throw new Error("Reference member requires reference scope");
		if (referenceScope !== null) {
			if (
				!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(referenceScope) ||
				Buffer.byteLength(referenceScope) > 512 ||
				!url.searchParams.has("provider_type") ||
				!url.searchParams.has("provider_name") ||
				["search", "choice_after", "cursor", "facet", "view", "after"].some(key => url.searchParams.has(key)) ||
				documentPath ||
				url.hash
			)
				throw new Error("Invalid explicit reference discovery");
			if (referenceMember !== null && !["name", "namespace", "tenant", "kind", "uid"].includes(referenceMember))
				throw new Error("Invalid reference member");
		}
		const limitValue = url.searchParams.get("limit");
		if (limitValue !== null && !/^(?:[1-9]|10)$/.test(limitValue))
			throw new Error("Terraform search limit must be 1 to 10");
		const limit = limitValue === null ? 5 : Number(limitValue);
		const choiceAfter = url.searchParams.get("choice_after");
		if (
			choiceAfter !== null &&
			((!search && exactAlias === null) || documentPath || !/^(?:0|[1-9][0-9]*)$/.test(choiceAfter))
		)
			throw new Error("Invalid Terraform choice continuation");
		const view = url.searchParams.get("view");
		if (view !== null && !["hint", "context", "full"].includes(view)) throw new Error("Invalid Terraform view");
		const node = url.searchParams.get("node");
		if (node !== null && (!node || Buffer.byteLength(node) > 1024)) throw new Error("Invalid Terraform node");
		const facet = url.searchParams.get("facet");
		const facetNames = ["provider_type", "provider_name", "role", "category", "capability", "task"];
		if (facet !== null && !facetNames.includes(facet)) throw new Error("Invalid Terraform facet");
		if (documentPath) safePath(documentPath);
		if (url.searchParams.has("after") && view !== "context") throw new Error("Terraform after requires context view");
		if (url.searchParams.has("cursor") && documentPath) throw new Error("Terraform cursor requires discovery");
		if (documentPath && (search || node || facet || limitValue || facetNames.some(k => url.searchParams.has(k))))
			throw new Error("Terraform discovery requires the inventory path");
		if (facet && (search || node || view || url.hash || choiceAfter !== null || url.searchParams.has("after")))
			throw new Error("Invalid Terraform facet combination");
		if (!documentPath && (view || url.hash || url.searchParams.has("after")))
			throw new Error("Terraform view requires a document path");
		if (!facet && !node && url.searchParams.has("cursor"))
			throw new Error("Terraform cursor requires facets or navigation");
		if (
			!documentPath &&
			!search &&
			!node &&
			!facet &&
			referenceScope === null &&
			enumValue === null &&
			exactAlias === null &&
			url.searchParams.size
		)
			throw new Error("Terraform filters and limit require discovery");
		const filters: Array<{ key: string; value: string }> = [];
		for (const key of facetNames) {
			const value = url.searchParams.get(key);
			if (value === null) continue;
			if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`Invalid Terraform filter: ${key}`);
			filters.push({ key, value });
		}
		const db = await this.database();
		const provenance = `Provider: ${this.assets.pin.provider_version}\nSnapshot: ${this.assets.pin.release_tag}\nCommit: ${this.assets.pin.source_commit}\nReceipt SHA-256: ${this.assets.pin.receipt_sha256}`;
		const uri = (p: string, a = "", v = "") =>
			`xcsh://terraform-documentation/${p}${v ? `?view=${v}` : ""}${a ? `#${encodeURIComponent(a)}` : ""}`;
		const prerequisites = (p: string, a: string) =>
			(
				db
					.query(
						"SELECT type,target_path,target_anchor,enforcement FROM terraform_relationships WHERE path=? AND anchor=? ORDER BY type,target_path,target_anchor LIMIT 2",
					)
					.all(p, a) as Array<{ type: string; target_path: string; target_anchor: string; enforcement: string }>
			)
				.map(r => `- ${r.type} (${r.enforcement}): ${uri(r.target_path, r.target_anchor, "hint")}`)
				.join("\n");
		if (exactAlias !== null) {
			const rows = lookupTerraformAlias(db, exactAlias, {
				providerType: url.searchParams.get("provider_type")!,
				providerName: url.searchParams.get("provider_name")!,
				filters,
				node: node ?? undefined,
			});
			const prefix = `${provenance}\n\nVerified alias destinations: ${exactAlias}\nCompare exact sections and the original request before selecting. Alias matches do not establish support or resolve missing branches.`;
			const content = rows.length
				? terraformChoiceResponse(
						prefix,
						rows.map(row => {
							const refine = new URL("xcsh://terraform-documentation/");
							refine.searchParams.set("node", row.id);
							refine.searchParams.set("search", exactAlias);
							for (const filter of filters) refine.searchParams.set(filter.key, filter.value);
							return `Read: ${uri(row.path, row.anchor, "context")}\nRefine: ${refine.href}`;
						}),
						url,
						choiceAfter,
						3000,
					)
				: `${prefix}\nNo verified alias destinations within caller scope.`;
			if (!rows.length && choiceAfter !== null) throw new Error("Invalid Terraform alias continuation");
			return { url: url.href, content, contentType: "text/markdown", size: Buffer.byteLength(content) };
		}
		if (enumValue !== null) {
			const rows = searchPropertyEnumValue(
				db,
				enumValue,
				{
					providerType: filters.find(f => f.key === "provider_type")!.value,
					providerName: filters.find(f => f.key === "provider_name")!.value,
					filters,
					node: node ?? undefined,
				},
				10000,
			);
			const content = boundedTerraformResponse(
				`${provenance}\n\nEnum value: ${JSON.stringify(enumValue)}\n${rows.length ? "Verified enum destinations; compare exact field sections before selecting a destination." : "No verified enum destinations in caller scope. Coverage may be unresolved; this does not establish unsupported input."}`,
				rows
					.slice(0, limit)
					.map(
						row =>
							`Read: ${uri(row.path, row.anchor, "context")}\nVerified enum field: ${row.schema_path}\n${prerequisites(row.path, row.anchor)}`,
					),
				4096,
				"If destinations are omitted by count or byte budget, narrow node/facets.",
			);
			return { url: url.href, content, contentType: "text/markdown", size: Buffer.byteLength(content) };
		}
		if (referenceScope !== null) {
			const rows = lookupReferenceMembers(
				db,
				{
					providerType: filters.find(f => f.key === "provider_type")!.value,
					providerName: filters.find(f => f.key === "provider_name")!.value,
					scopePath: referenceScope.split("."),
					member: (referenceMember as TerraformReferenceIdentity["member"] | undefined) ?? undefined,
					filters,
					node: node ?? undefined,
				},
				10000,
			);
			const entries = rows
				.slice(0, limit)
				.map(
					row =>
						`Read: ${uri(row.path, row.anchor, "context")}\nVerified reference member: ${row.schema_path}\n${prerequisites(row.path, row.anchor)}`,
				);
			const content = boundedTerraformResponse(
				`${provenance}\n\nReference scope: ${referenceScope}\n${rows.length ? "Verified reference members; compare exact sections before selecting a destination." : "No verified reference members in caller scope. Missing evidence does not establish unsupported input."}`,
				entries,
				4096,
				"If reference members are omitted by count or byte budget, specify reference_member or narrow node/facets.",
			);
			return { url: url.href, content, contentType: "text/markdown", size: Buffer.byteLength(content) };
		}
		let content: string;
		if (documentPath) {
			const row = db.query("SELECT metadata,markdown FROM terraform_documents WHERE path=?").get(documentPath) as {
				metadata: string;
				markdown: string;
			} | null;
			if (!row) throw new Error(`Terraform document not found: ${documentPath}`);
			const anchor = decodeURIComponent(url.hash.slice(1));
			const selected = anchor
				? (db
						.query(
							"SELECT anchor,heading,context_markdown AS markdown,ordinal FROM terraform_sections WHERE path=? AND anchor=?",
						)
						.get(documentPath, anchor) as {
						anchor: string;
						heading: string;
						markdown: string;
						ordinal: number;
					} | null)
				: null;
			if (anchor && !selected) throw new Error(`Terraform anchor not found: ${anchor}`);
			const metadata = JSON.parse(row.metadata) as TerraformMetadata;
			const ownershipScope = (sectionAnchor: string): string => {
				const section = metadata.sections?.find(section => section.anchor === sectionAnchor);
				if (!section?.reference_identity) return "";
				const target = referenceScopeDestination(
					db,
					metadata.provider_type,
					metadata.provider_name,
					section.schema_path.join("."),
				);
				return target && !(target.path === documentPath && target.anchor === sectionAnchor)
					? `Reference context: ${uri(target.path, target.anchor, "context")}`
					: "";
			};
			const ownershipHint = (sectionAnchor: string) => {
				const section = metadata.sections?.find(section => section.anchor === sectionAnchor);
				return section ? referenceOwnershipHint(section.reference_identity, section.schema_path) : "";
			};
			if (view === "hint") {
				const m = JSON.parse(row.metadata) as TerraformMetadata;
				const children = db
					.query(
						"SELECT path,summary FROM terraform_documents WHERE parent_id=? ORDER BY path COLLATE BINARY LIMIT 5",
					)
					.all(m.id) as Array<{ path: string; summary: string }>;
				const sections = db
					.query(
						"SELECT anchor,heading FROM terraform_sections WHERE path=? AND anchor LIKE 'schema-%' ORDER BY ordinal LIMIT 5",
					)
					.all(documentPath) as Array<{ anchor: string; heading: string }>;
				content = boundedTerraformResponse(
					`${provenance}\n\n${m.summary}\nRead: ${uri(documentPath, anchor, "context")}\nFull: ${uri(documentPath, anchor, "full")}\n${prerequisites(documentPath, anchor || "section")}`,
					[
						...(ownershipHint(anchor) ? [ownershipHint(anchor)] : []),
						...(ownershipScope(anchor) ? [ownershipScope(anchor)] : []),
						...children.map(c => `- ${c.summary}: ${uri(c.path, "", "hint")}`),
						...sections.map(c => `- ${c.heading}: ${uri(documentPath, c.anchor, "context")}`),
					],
					4096,
					`More: xcsh://terraform-documentation/?node=${encodeURIComponent(m.id)}`,
				);
			} else if (view === "context") {
				const after = url.searchParams.get("after");
				if (after !== null && anchor) throw new Error("Terraform context after cannot combine with an anchor");
				let ordinal = -1;
				if (after !== null) {
					const cursor = db
						.query("SELECT ordinal FROM terraform_sections WHERE path=? AND anchor=?")
						.get(documentPath, after) as { ordinal: number } | null;
					if (!cursor) throw new Error("Invalid Terraform context continuation");
					ordinal = cursor.ordinal;
				}
				const sections = selected
					? [
							{
								...selected,
								markdown: (
									db
										.query("SELECT context_markdown FROM terraform_sections WHERE path=? AND anchor=?")
										.get(documentPath, selected.anchor) as { context_markdown: string }
								).context_markdown,
							},
						]
					: (db
							.query(
								"SELECT anchor,heading,context_markdown AS markdown,ordinal FROM terraform_sections WHERE path=? AND ordinal>? AND context_alias=0 ORDER BY ordinal",
							)
							.all(documentPath, ordinal) as Array<{
							anchor: string;
							heading: string;
							markdown: string;
							ordinal: number;
						}>);
				const pieces: string[] = [];
				let last: string | undefined;
				const prefix = `${provenance}\nDocument: ${documentPath}\nFull: ${uri(documentPath, anchor, "full")}\n\n`;
				const reserve = 1500;
				const seen = new Set<string>();
				for (const section of sections) {
					// Heading and explicit-anchor aliases stay available to exact reads, but consume context once.
					const canonical = section.markdown.replace(/^\s*<a[^>]+><\/a>\s*\n/, "").trim();
					if (seen.has(canonical)) continue;
					seen.add(canonical);
					const ownership = ownershipHint(section.anchor);
					const body = [
						prerequisites(documentPath, section.anchor),
						terraformConflictContext(db, documentPath, section.anchor),
						ownership,
						ownershipScope(section.anchor),
						rewriteTerraformLinks(section.markdown, documentPath),
					]
						.filter(Boolean)
						.join("\n\n");
					const link = uri(documentPath, section.anchor, "full");
					if (Buffer.byteLength(prefix + body) > 16384 - reserve) {
						const notice = `Oversized section: ${section.heading}. Complete section: ${link}`;
						if (Buffer.byteLength(prefix + pieces.join("\n\n") + notice) > 16384 - reserve) break;
						pieces.push(notice);
						last = section.anchor;
						continue;
					}
					if (Buffer.byteLength(prefix + pieces.join("\n\n") + body) > 16384 - reserve) break;
					pieces.push(body);
					last = section.anchor;
					if (selected) break;
				}
				const remaining =
					last && sections.some(s => s.ordinal > (sections.find(v => v.anchor === last)?.ordinal ?? Infinity));
				content =
					prefix +
					pieces.join("\n\n") +
					(remaining
						? `\n\nContinue: xcsh://terraform-documentation/${documentPath}?view=context&after=${encodeURIComponent(last!)}`
						: "");
			} else {
				if (url.searchParams.has("after")) throw new Error("Terraform after requires context view");
				const sections = db
					.query(
						"SELECT heading,anchor FROM terraform_sections WHERE path=? AND anchor LIKE 'schema-%' ORDER BY ordinal LIMIT 10",
					)
					.all(documentPath) as Array<{ heading: string; anchor: string }>;
				content = `${provenance}\nDocument: ${documentPath}\n${this.#trace(db, documentPath)}\nProperty sections:\n${sections.map(p => `- [${p.heading}](${uri(documentPath, p.anchor)})`).join("\n")}\nPinned source: https://github.com/${this.assets.pin.source_repository}/blob/${this.assets.pin.source_commit}/${documentPath}\n\n${rewriteTerraformLinks(anchor ? terraformPassages(splitMarkdown(row.markdown).body).find(p => p.anchor === anchor)!.markdown : row.markdown, documentPath)}`;
			}
		} else if (facet) {
			const cursor = url.searchParams.get("cursor") ?? "";
			if (cursor && (!/^[A-Za-z0-9_.-]+$/.test(cursor) || Buffer.byteLength(cursor) > 256))
				throw new Error("Invalid Terraform facet cursor");
			const clauses = filters.map(
				() => "EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=tf.path AND f.facet=? AND f.value=?)",
			);
			const rows = db
				.query(
					`SELECT tf.value,COUNT(*) count FROM terraform_facets tf WHERE tf.facet=? AND tf.value>? ${clauses.length ? `AND ${clauses.join(" AND ")}` : ""} GROUP BY tf.value ORDER BY tf.value COLLATE BINARY LIMIT ?`,
				)
				.all(facet, cursor, ...filters.flatMap(f => [f.key, f.value]), limit + 1) as Array<{
				value: string;
				count: number;
			}>;
			const shown = rows.slice(0, limit);
			const next = new URL(url.href);
			if (shown.length) next.searchParams.set("cursor", shown.at(-1)!.value);
			content = boundedTerraformResponse(
				`${provenance}\n\nFacet: ${facet}`,
				shown.map(r => `- ${r.value}: ${r.count}`),
				4096,
				rows.length > limit ? `Continue: ${next.href}` : "",
			);
		} else if (search) {
			const queryIdentity = terraformQueryIdentity(search);
			const explicitProviderNames = [
				...new Set([...search.matchAll(/\bxcsh_([a-z][a-z0-9_]*)\b/gi)].map(match => match[1]!.toLowerCase())),
			];
			const explicitRole =
				/\b(?:resources?|data[ -]sources?|actions?|ephemeral)\b|\b(?:data|resource|ephemeral)\.xcsh_/i.test(search);
			const indexedRoles =
				explicitProviderNames.length === 1 && !explicitRole
					? (db
							.query(
								"SELECT DISTINCT provider_type FROM terraform_documents WHERE provider_name=? ORDER BY provider_type",
							)
							.all(explicitProviderNames[0]!) as { provider_type: string }[])
					: [];
			const resolvedIdentityRole =
				indexedRoles.length === 1 ? indexedRoles[0]!.provider_type : queryIdentity.providerType;
			const inferredTaskRole = filters.find(f => f.key === "provider_type")?.value ?? resolvedIdentityRole;
			const taskNames = (
				db
					.query(
						"SELECT DISTINCT provider_name FROM terraform_documents WHERE (? IS NULL OR provider_type=?) ORDER BY provider_name",
					)
					.all(inferredTaskRole ?? null, inferredTaskRole ?? null) as Array<{ provider_name: string }>
			).map(r => r.provider_name);
			let taskProvider =
				filters.find(f => f.key === "provider_name")?.value ?? terraformProviderMention(search, taskNames);
			if (!taskProvider && inferredTaskRole === "actions" && !propertyRequestedText(search)) {
				const matches = rankTerraformProviderNames(search, taskNames);
				if (matches[0] && (!matches[1] || matches[0].score >= matches[1].score + 10))
					taskProvider = matches[0].name;
			}
			const taskDecision = resolveIndexedTask(db, search, {
				providerType: inferredTaskRole,
				providerName: taskProvider,
				inferredIdentity: !filters.some(f => f.key === "provider_name"),
				filters,
				node: node ?? undefined,
			});
			if (taskDecision && (taskDecision.destinations.length || taskDecision.kind === "none")) {
				if (choiceAfter !== null) throw new Error("Terraform choice continuation requires branch choices");
				const taskContent = boundedTerraformResponse(
					`${provenance}\n\n# Terraform search: ${search}\n${taskDecision.kind === "leaf" ? "Selected leaf; read its complete section before drafting." : taskDecision.kind === "none" ? "No results. Caller scope has no compatible destination." : "Narrowing choices; clarify the missing authentication method, provider role, or action cardinality."}\nReason: ${taskDecision.reason}${taskDecision.reason === "Missing authentication method" ? `\nOverview: ${uri("documentation/provider/setup/index.md", "authentication-options", "context")}` : ""}`,
					taskDecision.destinations
						.slice(0, limit)
						.map(
							row =>
								`Read: ${uri(row.path, row.anchor, "context")}\n${row.description}\n${prerequisites(row.path, row.anchor)}`,
						),
					4096,
				);
				return {
					url: url.href,
					content: taskContent,
					contentType: "text/markdown",
					size: Buffer.byteLength(taskContent),
				};
			}
			if (
				(Boolean(propertyRequestedText(search)) ||
					/\bconfigure\b/i.test(search) ||
					Boolean(propertyRequestedBlockText(search)) ||
					/\b(?:select|choose|enable|disable)\b/i.test(search) ||
					(/\bcookie\b/i.test(search) && /\b(?:persistence|affinity|stickiness)\b/i.test(search)) ||
					/\b(?:configuration|schema) block\b|\bwhich block\b|\b(?:which|what)\b.*\bblock\b/i.test(search) ||
					/\blistening\b.*\bport\b|\b(?:fields?|attributes?|property|properties|parameters?|arguments?|flags?)\b|\bschema block\b|\bblock\b.*\b(?:secret|credentials?)\b|\bwhere\b.*\b(?:specify|set|configure or reference)\b/i.test(
						search,
					)) &&
				(!filters.some(f => f.key === "role") || filters.some(f => f.key === "role" && f.value === "properties")) &&
				(!propertyRequestsBlock(search) ||
					Boolean(propertyRequestedBlockText(search)) ||
					/\b(?:select|choose|enable|disable)\b/i.test(search) ||
					(/\bcookie\b/i.test(search) && /\b(?:persistence|affinity|stickiness)\b/i.test(search)) ||
					/\b(?:secret|credentials?)\b|\b(?:configuration|schema) block\b|\bwhich block\b|\b(?:which|what)\b.*\bblock\b/i.test(
						search,
					)) &&
				!terraformTaskDestination(search) &&
				!terraformProviderSetupDestination(search) &&
				(!/\b(?:guidance|help|begin|start|explain)\b/i.test(search) ||
					(Boolean(propertyRequestedText(search)) && /`[a-z][a-z0-9_]*`/.test(search))) &&
				db.query("SELECT 1 FROM sqlite_master WHERE name=?").get("property_terms")
			) {
				const role = filters.find(f => f.key === "provider_type")?.value ?? resolvedIdentityRole;
				const provider = taskProvider;

				const lifecycle = interpretTerraformLifecycle(search);
				const timeoutPaths = lifecycle
					? lifecycle.field
						? (lifecycle.operations.length ? lifecycle.operations : ["create", "read", "update", "delete"]).map(
								operation => `timeouts.${operation}`,
							)
						: ["timeouts"]
					: [];

				const poolStatus: { truncated?: boolean } = {};
				const ranked = searchPropertyIndex(
					db,
					search,
					{
						providerType: role,
						providerName: provider,
						schemaPaths: timeoutPaths,
						filters,
						node: node ?? undefined,
					},
					2000,
					poolStatus,
				).filter(row => lifecycle?.field || !propertyRequestsBlock(search) || row.anchor === "section");
				const genericConfigure =
					/\bconfigure\b/i.test(search) && !propertyRequestedText(search) && !propertyRequestedBlockText(search);
				const aliasClauses = [
					"provider_name=?",
					"(? IS NULL OR provider_type=?)",
					"instr(alias,' ')>0",
					"instr(?, ' ' || alias || ' ')>0",
				];
				const aliasValues = [provider ?? "", role ?? null, role ?? null, terraformAliasQueryText(search)];
				for (const filter of filters) {
					aliasClauses.push(
						"EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=terraform_aliases.path AND f.facet=? AND f.value=?)",
					);
					aliasValues.push(filter.key, filter.value);
				}
				if (node) {
					aliasClauses.push(
						"path IN (WITH RECURSIVE descendants(id,path) AS (SELECT id,path FROM terraform_documents WHERE id=? UNION SELECT d.id,d.path FROM terraform_documents d JOIN descendants p ON d.parent_id=p.id) SELECT path FROM descendants)",
					);
					aliasValues.push(node);
				}
				const aliasNavigation =
					genericConfigure &&
					provider &&
					db
						.query(`SELECT 1 FROM terraform_aliases WHERE ${aliasClauses.join(" AND ")} LIMIT 1`)
						.get(...aliasValues);
				if (!genericConfigure || (ranked.length > 0 && !aliasNavigation)) {
					if (ranked[0]?.anchor === "section" && !propertyRequestsBlock(search)) {
						const record = db
							.query("SELECT metadata FROM terraform_documents WHERE path=?")
							.get(ranked[0].path) as {
							metadata: string;
						};
						const metadata = JSON.parse(record.metadata) as TerraformMetadata;
						const refined = rankTerraformDirectProperties(search, metadata.schema_path, metadata.sections ?? []);
						if (refined[0]?.document_id === metadata.id) {
							const refinedRows = refineRankedProperty(ranked, ranked[0].path, refined[0].anchor);
							ranked.splice(0, ranked.length, ...refinedRows);
						}
					}
					const first = ranked[0];
					const leaf = first?.schema_path.split(".").at(-1);
					const clauses = filters.map(
						() => "EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=dest.path AND f.facet=? AND f.value=?)",
					);

					const preparedLeaf =
						first && !lifecycle
							? (db
									.query(
										"SELECT leaf FROM property_terms WHERE provider_type=? AND provider_name=? AND schema_path=?",
									)
									.get(first.provider_type, first.provider_name, first.schema_path) as { leaf: string } | null)
							: null;
					const alternativeScope = lifecycle
						? `dest.schema_path IN (${timeoutPaths.map(() => "?").join(",")})`
						: "leaf=? AND (schema_path=? OR substr(schema_path,-length(?))=?)";
					const values: Array<string | null> = [
						first?.provider_name ?? null,
						role ?? null,
						role ?? null,
						...(lifecycle ? timeoutPaths : [preparedLeaf?.leaf ?? null, leaf ?? null, `.${leaf}`, `.${leaf}`]),
						...filters.flatMap(f => [f.key, f.value]),
					];
					if (node) {
						clauses.push(
							"dest.path IN (WITH RECURSIVE descendants(id,path) AS (SELECT id,path FROM terraform_documents WHERE id=? UNION SELECT d.id,d.path FROM terraform_documents d JOIN descendants p ON d.parent_id=p.id) SELECT path FROM descendants)",
						);
						values.push(node);
					}
					const alternatives = first
						? (
								db
									.query(
										`SELECT provider_type,provider_name,schema_path,path,anchor,description,type,nesting,flags FROM property_terms dest WHERE provider_name=? AND (? IS NULL OR provider_type=?) AND ${alternativeScope} ${clauses.length ? `AND ${clauses.join(" AND ")}` : ""} ORDER BY provider_type,schema_path`,
									)
									.all(...values) as RankedProperty[]
							).map(row => ({
								...row,
								...(row.flags == null ? {} : { flags: JSON.parse(row.flags as unknown as string) as string[] }),
								score: 0,
								coverage: 0,
							}))
						: [];
					const decision = selectPropertyDestination(search, ranked, alternatives, {
						lifecycle,
						identityResolved: Boolean(provider && role),
						candidatePoolComplete: poolStatus.truncated !== true,
					});

					const allowedAlternatives = filterSecretRepresentation(search, alternatives).filter(row =>
						matchesFieldAccess(row, requestedFieldAccess(search)),
					);
					if (decision.kind === "choices" && first) {
						const equivalent = [
							...new Map(
								[...decision.destinations, ...allowedAlternatives]
									.filter(
										row => row.provider_name === first.provider_name && row.description === first.description,
									)
									.map(row => [`${row.provider_type}:${row.schema_path}`, row]),
							).values(),
						];
						const roles = terraformRoleChoices(equivalent, limit);
						if (
							roles.length &&
							decision.destinations.every(
								row => row.provider_name === first.provider_name && row.description === first.description,
							)
						) {
							const roleContent = terraformChoiceResponse(
								`${provenance}\n\n# Terraform search: ${search}\nNarrowing choices; clarify the missing provider role.\nReason: Equivalent property destinations span provider roles.`,
								roles.map(role => {
									const next = new URL(url.href);
									next.searchParams.delete("choice_after");
									next.searchParams.set("provider_type", role);
									next.searchParams.set("provider_name", first.provider_name);
									return `## ${role}: xcsh_${first.provider_name}\nRefine: ${next.href}`;
								}),
								url,
								choiceAfter,
								4096,
							);
							return {
								url: url.href,
								content: roleContent,
								contentType: "text/markdown",
								size: Buffer.byteLength(roleContent),
							};
						}
					}
					if (
						decision.kind === "choices" &&
						first &&
						decision.destinations.every(
							row =>
								row.provider_type === first.provider_type &&
								row.provider_name === first.provider_name &&
								row.description === first.description,
						)
					) {
						const equivalent = [
							...new Map(
								[...decision.destinations, ...allowedAlternatives]
									.filter(
										row =>
											row.provider_type === first.provider_type &&
											row.provider_name === first.provider_name &&
											row.description === first.description,
									)
									.map(row => [row.schema_path, row]),
							).values(),
						];
						const branches = terraformBranchChoices(equivalent, limit, search);
						const destinations = branches.map(
							schemaPath =>
								db
									.query(
										"SELECT td.id,td.path,td.summary,dest.anchor FROM terraform_destinations dest JOIN terraform_documents td ON td.path=dest.path WHERE dest.provider_type=? AND dest.provider_name=? AND dest.schema_path=? AND dest.anchor=?",
									)
									.get(first.provider_type, first.provider_name, schemaPath, "section") as {
									id: string;
									path: string;
									summary: string;
									anchor: string;
								} | null,
						);
						if (destinations.length && destinations.every(row => row !== null)) {
							const branchContent = terraformChoiceResponse(
								`${provenance}\n\n# Terraform search: ${search}\nNarrowing choices; clarify the missing schema branch.\nReason: ${decision.reason}\nEquivalent property destinations require a branch decision.`,
								destinations.map(row => {
									const next = new URL(url.href);
									next.searchParams.delete("choice_after");
									next.searchParams.set("node", row!.id);
									next.searchParams.set("provider_type", first.provider_type);
									next.searchParams.set("provider_name", first.provider_name);
									return `## ${row!.summary}\nHint: ${uri(row!.path, row!.anchor, "hint")}\nRefine: ${next.href}`;
								}),
								url,
								choiceAfter,
								4096,
							);
							return {
								url: url.href,
								content: branchContent,
								contentType: "text/markdown",
								size: Buffer.byteLength(branchContent),
							};
						}
					}
					if (choiceAfter !== null)
						throw new Error("Terraform choice continuation no longer matches branch choices");
					const shown =
						decision.kind === "leaf" || (lifecycle?.operations.length ?? 0) > 1
							? decision.destinations
							: decision.destinations.slice(0, limit);
					const continuation = new URL(url.href);
					continuation.searchParams.set("node", node ?? "xcsh-docs:provider:xcsh:navigation");
					const prepared = boundedTerraformResponse(
						`${provenance}\n\n# Terraform search: ${search}\n${decision.kind === "leaf" ? "Selected leaf; read its complete section before drafting." : shown.length ? "Narrowing choices; compare these candidates with the full request. Clarify only an unspecified role or branch." : "No results."}\nReason: ${decision.reason}${decision.kind === "choices" && !role && provider ? `\n${terraformLeadingRoleHint(shown)}` : ""}\nScores are ranking values, not probabilities.`,
						shown.map(
							row =>
								`## ${row.provider_type}: xcsh_${row.provider_name}\nSchema path: ${row.schema_path}${row.flags?.length ? `\nDocumented flags: ${row.flags.join(", ")}` : ""}\nScore: ${Number(row.score.toFixed(12))}\nRead: ${uri(row.path, row.anchor, "context")}\n${prerequisites(row.path, row.anchor)}\n${row.description}`,
						),
						4096,
						`Refine: ${continuation.href}`,
					);
					return {
						url: url.href,
						content: prepared,
						contentType: "text/markdown",
						size: Buffer.byteLength(prepared),
					};
				}
			}
			const navigationRequest =
				/(?:which|what).*documentation|where.*(?:begin|start)|need.*(?:help|guidance)|(?:resource.*data[ -]source|data[ -]source.*resource)|explain.*fields/i.test(
					search,
				);
			const setupAnchor = terraformProviderSetupDestination(search);
			let query = terraformSearchQuery(search);
			const identity = { ...queryIdentity, providerType: resolvedIdentityRole };
			if (!setupAnchor && !filters.some(f => f.key === "provider_type") && identity.providerType)
				filters.push({ key: "provider_type", value: identity.providerType });
			const propertyMention = /where is (.*?) documented/i.exec(search)?.[1];
			const propertySearch = propertyMention
				? ` ${propertyMention
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, " ")
						.trim()} `
				: undefined;
			const normalizedSearch = terraformAliasQueryText(search);
			if (!setupAnchor && !filters.some(f => f.key === "provider_name")) {
				const identityRole = filters.find(filter => filter.key === "provider_type")?.value;
				const names = db
					.query(
						"SELECT DISTINCT provider_name value FROM terraform_documents WHERE provider_name!='xcsh' AND (? IS NULL OR provider_type=?) ORDER BY provider_name",
					)
					.all(identityRole ?? null, identityRole ?? null) as Array<{ value: string }>;
				let named = terraformProviderMention(
					search,
					names.map(name => name.value),
				);
				if (!named && filters.find(filter => filter.key === "provider_type")?.value === "actions") {
					const actionNames = db
						.query(
							"SELECT DISTINCT provider_name value FROM terraform_documents WHERE provider_type='actions' ORDER BY provider_name",
						)
						.all() as Array<{ value: string }>;
					const matches = rankTerraformProviderNames(
						search,
						actionNames.map(row => row.value),
					);
					if (matches[0] && (!matches[1] || matches[0].score >= matches[1].score + 10)) named = matches[0].name;
				}
				if (named) filters.push({ key: "provider_name", value: named });
			}
			query =
				terraformScopedSearchQuery(search, filters.find(filter => filter.key === "provider_name")?.value) || query;
			const clauses = ["documents_fts MATCH ?", "d.active=1"];
			const args: Array<string | number> = [query];
			for (const f of filters) {
				clauses.push("EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=td.path AND f.facet=? AND f.value=?)");
				args.push(f.key, f.value);
			}
			let cte = "";
			if (node) {
				if (!db.query("SELECT 1 FROM terraform_documents WHERE id=?").get(node))
					throw new Error("Terraform node not found");
				cte =
					"WITH RECURSIVE descendants(id) AS (SELECT id FROM terraform_documents WHERE id=? UNION SELECT d.id FROM terraform_documents d JOIN descendants n ON d.parent_id=n.id), ";
				args.unshift(node);
				clauses.push("td.id IN (SELECT id FROM descendants)");
			}
			const sql = `${cte || "WITH "}scored AS (
                SELECT td.path,p.anchor,p.heading,p.ordinal,d.hash,
                  ABS(bm25(documents_fts,1.5,4.0,1.0)) raw_score
                FROM documents_fts JOIN documents d ON d.id=documents_fts.rowid
                JOIN terraform_passages p ON p.qmd_path=d.path JOIN terraform_documents td ON td.path=p.path WHERE ${clauses.join(" AND ")}),
                selected AS (SELECT * FROM scored ORDER BY raw_score DESC,path COLLATE BINARY,ordinal LIMIT ?)
                SELECT selected.*,td.metadata,c.doc AS markdown,raw_score/(1+raw_score) score
                FROM selected JOIN terraform_documents td ON td.path=selected.path JOIN content c ON c.hash=selected.hash
                ORDER BY raw_score DESC,selected.path COLLATE BINARY,ordinal`;
			const statement = db.query(sql);
			type SearchRow = {
				path: string;
				metadata: string;
				anchor: string;
				heading: string;
				markdown: string;
				score: number;
				raw_score: number;
			};
			args.push(limit);
			let rows: SearchRow[] = [];
			let broadened = false;
			let unresolvedChoice = false;
			// Exact schema terminology routes through indexed destinations, before passage ranking.
			const providerFilter = filters.find(f => f.key === "provider_name");

			if (providerFilter && !navigationRequest) {
				const destinationClauses = ["dest.provider_name=?", "instr(?, ' ' || dest.phrase || ' ')>0"];
				const destinationArgs: Array<string | number> = [providerFilter.value, propertySearch ?? normalizedSearch];
				for (const f of filters) {
					destinationClauses.push(
						"EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=dest.path AND f.facet=? AND f.value=?)",
					);
					destinationArgs.push(f.key, f.value);
				}
				if (node) {
					destinationClauses.push(
						"dest.path IN (WITH RECURSIVE descendants(id,path) AS (SELECT id,path FROM terraform_documents WHERE id=? UNION SELECT d.id,d.path FROM terraform_documents d JOIN descendants n ON d.parent_id=n.id) SELECT path FROM descendants)",
					);
					destinationArgs.push(node);
				}
				destinationClauses.push(
					propertySearch
						? "1=1 OR (? IS NULL AND ? IS NULL)"
						: "NOT (dest.phrase=? AND instr(?, ' name ')>0 AND dest.phrase!='name')",
				);
				destinationArgs.push(providerFilter.value.replaceAll("_", " "), propertySearch ?? normalizedSearch);
				const exactRows = db
					.query(
						`SELECT dest.path,td.metadata,dest.anchor,dest.description heading,s.context_markdown markdown,length(dest.phrase) specificity FROM terraform_destinations dest JOIN terraform_documents td ON td.path=dest.path JOIN terraform_sections s ON s.path=dest.path AND s.anchor=dest.anchor WHERE ${destinationClauses.join(" AND ")} ORDER BY specificity DESC,dest.path COLLATE BINARY LIMIT ?`,
					)
					.all(...destinationArgs, limit) as Array<{
					path: string;
					metadata: string;
					anchor: string;
					heading: string;
					markdown: string;
					specificity: number;
				}>;
				if (exactRows.length) {
					const best = exactRows[0]!.specificity;
					rows = exactRows
						.filter(r => r.specificity === best)
						.map(r => ({
							...r,
							raw_score: 100 + r.specificity,
							score: Number(((100 + r.specificity) / (101 + r.specificity)).toFixed(12)),
						}));
					broadened = false;
				}
			}
			if (providerFilter && !navigationRequest && !propertyMention) {
				const aliasClauses = ["a.provider_name=?", "instr(?, ' ' || a.alias || ' ')>0"];
				const aliasArgs: Array<string | number> = [providerFilter.value, normalizedSearch];
				for (const f of filters) {
					aliasClauses.push(
						"EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=a.path AND f.facet=? AND f.value=?)",
					);
					aliasArgs.push(f.key, f.value);
				}
				if (node) {
					aliasClauses.push(
						"a.path IN (WITH RECURSIVE descendants(id,path) AS (SELECT id,path FROM terraform_documents WHERE id=? UNION SELECT d.id,d.path FROM terraform_documents d JOIN descendants p ON d.parent_id=p.id) SELECT path FROM descendants)",
					);
					aliasArgs.push(node);
				}
				let aliasRows = db
					.query(
						`SELECT a.path,td.metadata,a.anchor,s.heading,s.context_markdown markdown,length(a.alias) specificity,dest.schema_path destination_schema_path FROM terraform_aliases a JOIN terraform_documents td ON td.path=a.path JOIN terraform_sections s ON s.path=a.path AND s.anchor=a.anchor LEFT JOIN terraform_destinations dest ON dest.provider_name=a.provider_name AND dest.provider_type=a.provider_type AND dest.schema_path=replace(substr(a.anchor,8),'--','.') AND dest.path=a.path AND dest.anchor=a.anchor WHERE ${aliasClauses.join(" AND ")} ORDER BY specificity DESC,a.path COLLATE BINARY LIMIT ?`,
					)
					.all(...aliasArgs, 300) as Array<{
					path: string;
					metadata: string;
					anchor: string;
					heading: string;
					markdown: string;
					specificity: number;
					destination_schema_path: string | null;
				}>;
				const providerTerms = providerFilter.value.split("_");
				aliasRows = aliasRows
					.map(row => {
						const metadata = JSON.parse(row.metadata) as TerraformMetadata;
						return {
							...row,
							specificity:
								row.specificity +
								scoreTerraformAliasContext(
									search,
									row.destination_schema_path ?? metadata.schema_path.join("."),
									providerTerms,
								),
						};
					})
					.sort((a, b) => b.specificity - a.specificity || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
				if (aliasRows.length && (!rows.length || aliasRows[0]!.specificity > 10)) {
					const best = aliasRows[0]!.specificity;
					rows = aliasRows
						.filter(r => r.specificity === best)
						.map(r => ({
							...r,
							raw_score: 100 + r.specificity,
							score: (100 + r.specificity) / (101 + r.specificity),
						}));
					broadened = false;
				}
			}
			if (
				providerFilter &&
				!navigationRequest &&
				!node &&
				!propertyMention &&
				!filters.some(f => !["provider_name", "provider_type"].includes(f.key)) &&
				/\b(status|port|name|tenant|namespace|url|value)\b/i.test(search)
			) {
				const terminals: string[] =
					search.toLowerCase().match(/\b(status|port|name|tenant|namespace|url|value)\b/g) ?? [];
				const current = rows[0];
				if (current) {
					const m = JSON.parse(current.metadata) as TerraformMetadata;
					const prefix = `${m.schema_path.join(".")}.`;
					const candidates = db
						.query(
							"SELECT dest.path,td.metadata,dest.anchor,dest.description heading,s.context_markdown markdown,dest.schema_path FROM terraform_destinations dest JOIN terraform_documents td ON td.path=dest.path JOIN terraform_sections s ON s.path=dest.path AND s.anchor=dest.anchor WHERE dest.provider_name=? AND dest.provider_type=? AND substr(dest.schema_path,1,length(?))=? ORDER BY dest.schema_path COLLATE BINARY",
						)
						.all(providerFilter.value, m.provider_type, prefix, prefix) as Array<{
						path: string;
						metadata: string;
						anchor: string;
						heading: string;
						markdown: string;
						schema_path: string;
					}>;
					const direct = candidates.filter(
						c =>
							c.schema_path.split(".").length === m.schema_path.length + 1 &&
							terminals.includes(c.schema_path.split(".").at(-1)!),
					);
					if (direct.length === 1) {
						rows = direct.map(r => ({ ...r, raw_score: 200, score: 200 / 201 }));
						broadened = false;
					}
				}
			}
			if (rows.length === 1 && rows[0]?.anchor === "section" && !navigationRequest) {
				const parent = rows[0];
				const metadata = JSON.parse(parent.metadata) as TerraformMetadata;
				const refined = rankTerraformDirectProperties(search, metadata.schema_path, metadata.sections ?? []);
				if (refined[0]?.document_id === metadata.id) {
					const section = db
						.query(
							"SELECT anchor,heading,context_markdown markdown FROM terraform_sections WHERE path=? AND anchor=?",
						)
						.get(parent.path, refined[0].anchor) as { anchor: string; heading: string; markdown: string } | null;
					if (section) rows = [{ ...parent, ...section }];
				}
			}
			const taskDestination = terraformTaskDestination(search);
			const taskRole = taskDestination?.role;
			if (providerFilter && taskRole && !propertyMention) {
				const roleClauses = ["td.provider_name=?", "td.role=?"];
				const roleArgs: Array<string | number> = [providerFilter.value, taskRole];
				for (const filter of filters) {
					roleClauses.push(
						"EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=td.path AND f.facet=? AND f.value=?)",
					);
					roleArgs.push(filter.key, filter.value);
				}
				if (node) {
					roleClauses.push(
						"td.id IN (WITH RECURSIVE descendants(id) AS (SELECT id FROM terraform_documents WHERE id=? UNION SELECT d.id FROM terraform_documents d JOIN descendants n ON d.parent_id=n.id) SELECT id FROM descendants)",
					);
					roleArgs.push(node);
				}
				roleClauses.push(taskDestination?.anchor ? "s.anchor=?" : "s.ordinal=0");
				if (taskDestination?.anchor) roleArgs.push(taskDestination.anchor);
				const roleRows = db
					.query(
						`SELECT td.path,td.metadata,s.anchor,s.heading,s.context_markdown markdown FROM terraform_documents td JOIN terraform_sections s ON s.path=td.path WHERE ${roleClauses.join(" AND ")} ORDER BY td.path COLLATE BINARY LIMIT ?`,
					)
					.all(...roleArgs, limit) as Array<{
					path: string;
					metadata: string;
					anchor: string;
					heading: string;
					markdown: string;
				}>;
				if (roleRows.length) {
					rows = roleRows.map(row => ({ ...row, raw_score: 100, score: 100 / 101 }));
					broadened = false;
				}
			}

			const timeoutOperations = terraformTimeoutOperations(search);
			if (providerFilter && timeoutOperations.length && !taskDestination) {
				const conditions = [
					"dest.provider_name=?",
					`dest.schema_path IN (${timeoutOperations.map(() => "?").join(",")})`,
				];
				const values: Array<string | number> = [
					providerFilter.value,
					...timeoutOperations.map(operation => `timeouts.${operation}`),
				];
				for (const filter of filters) {
					conditions.push(
						"EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=dest.path AND f.facet=? AND f.value=?)",
					);
					values.push(filter.key, filter.value);
				}
				if (node) {
					conditions.push(
						"dest.path IN (WITH RECURSIVE descendants(id,path) AS (SELECT id,path FROM terraform_documents WHERE id=? UNION SELECT d.id,d.path FROM terraform_documents d JOIN descendants n ON d.parent_id=n.id) SELECT path FROM descendants)",
					);
					values.push(node);
				}
				const destinations = db
					.query(
						`SELECT dest.path,td.metadata,dest.anchor,s.heading,s.context_markdown markdown FROM terraform_destinations dest JOIN terraform_documents td ON td.path=dest.path JOIN terraform_sections s ON s.path=dest.path AND s.anchor=dest.anchor WHERE ${conditions.join(" AND ")} ORDER BY dest.provider_type,dest.schema_path LIMIT ?`,
					)
					.all(...values, limit) as SearchRow[];
				if (destinations.length) {
					rows = destinations.map(row => ({ ...row, raw_score: 200, score: 200 / 201 }));
					broadened = false;
				}
			}
			if (
				providerFilter &&
				!node &&
				!filters.some(f => f.key !== "provider_name") &&
				!propertyMention &&
				!taskRole &&
				(navigationRequest ||
					query
						.split(" AND ")
						.every(term =>
							Boolean(db.query("SELECT 1 FROM documents_fts WHERE documents_fts MATCH ? LIMIT 1").get(term)),
						))
			) {
				const choices = db
					.query(
						"SELECT td.path,td.metadata,s.anchor,s.heading,s.context_markdown markdown FROM terraform_documents td JOIN terraform_sections s ON s.path=td.path AND s.ordinal=0 WHERE td.provider_name=? AND td.role='fundamentals' ORDER BY td.provider_type,td.path COLLATE BINARY LIMIT ?",
					)
					.all(providerFilter.value, limit) as Array<{
					path: string;
					metadata: string;
					anchor: string;
					heading: string;
					markdown: string;
				}>;
				if (choices.length > 1 && (navigationRequest || !rows.length)) {
					rows = choices.map(r => ({ ...r, raw_score: 100, score: 100 / 101 }));
					broadened = false;
				}
			}
			if (providerFilter && !taskDestination && !setupAnchor && !navigationRequest) {
				const identifiers = [
					...new Set(
						(search.toLowerCase().match(/[a-z][a-z0-9]*_[a-z0-9_]+/g) ?? []).filter(
							term => !term.startsWith("xcsh_") && term !== providerFilter.value,
						),
					),
				];
				if (identifiers.length) {
					const exactClauses = [
						"dest.provider_name=?",
						"dest.anchor LIKE 'schema-%'",
						`(${identifiers.map(() => "dest.schema_path=? OR substr(dest.schema_path,-length(?))=?").join(" OR ")})`,
					];
					const exactArgs: Array<string | number> = [
						providerFilter.value,
						...identifiers.flatMap(term => [term, `.${term}`, `.${term}`]),
					];
					for (const filter of filters) {
						exactClauses.push(
							"EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=td.path AND f.facet=? AND f.value=?)",
						);
						exactArgs.push(filter.key, filter.value);
					}
					if (node) {
						exactClauses.push(
							"td.id IN (WITH RECURSIVE descendants(id) AS (SELECT id FROM terraform_documents WHERE id=? UNION SELECT d.id FROM terraform_documents d JOIN descendants n ON d.parent_id=n.id) SELECT id FROM descendants)",
						);
						exactArgs.push(node);
					}
					const exact = db
						.query(
							`SELECT dest.path,dest.anchor,dest.schema_path,td.metadata,s.heading,s.context_markdown markdown FROM terraform_destinations dest JOIN terraform_documents td ON td.path=dest.path JOIN terraform_sections s ON s.path=dest.path AND s.anchor=dest.anchor WHERE ${exactClauses.join(" AND ")} ORDER BY dest.schema_path COLLATE BINARY LIMIT 300`,
						)
						.all(...exactArgs) as Array<SearchRow & { schema_path: string }>;
					if (exact.length && exact.length < 300) {
						rows = exact
							.map(row => {
								const rank =
									300 + scoreTerraformAliasContext(search, row.schema_path, providerFilter.value.split("_"));
								return {
									...row,
									metadata: JSON.stringify({
										...JSON.parse(row.metadata),
										schema_path: row.schema_path.split("."),
									}),
									raw_score: rank,
									score: rank / (1 + rank),
								};
							})
							.sort((a, b) => b.raw_score - a.raw_score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
						const best = rows[0]!.raw_score;
						rows = rows.filter(row => row.raw_score === best);
						broadened = false;
					}
				}
			}
			const identifierExists = (term: string): boolean => {
				const scopeClauses = ["documents_fts MATCH ?"];
				const scopeArgs: Array<string | number> = [`"${term}"`];
				for (const filter of filters) {
					scopeClauses.push(
						"EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=td.path AND f.facet=? AND f.value=?)",
					);
					scopeArgs.push(filter.key, filter.value);
				}
				if (node) {
					scopeClauses.push(
						"td.id IN (WITH RECURSIVE descendants(id) AS (SELECT id FROM terraform_documents WHERE id=? UNION SELECT d.id FROM terraform_documents d JOIN descendants n ON d.parent_id=n.id) SELECT id FROM descendants)",
					);
					scopeArgs.push(node);
				}
				return Boolean(
					db
						.query(
							`SELECT 1 FROM documents_fts JOIN documents d ON d.id=documents_fts.rowid JOIN terraform_passages p ON p.qmd_path=d.path JOIN terraform_documents td ON td.path=p.path WHERE ${scopeClauses.join(" AND ")} LIMIT 1`,
						)
						.get(...scopeArgs),
				);
			};
			const unknownIdentifiers =
				search.match(/[a-z][a-z0-9]*_[a-z0-9_]+/gi)?.some(term => !identifierExists(term)) ?? false;
			if (unknownIdentifiers) rows = [];
			if (!rows.length && !unknownIdentifiers && !setupAnchor) {
				rows = query ? (statement.all(...args) as SearchRow[]) : [];
				if (!rows.length && query.includes(" AND ")) {
					const known = terraformKnownQueryTerms(query, term =>
						Boolean(db.query("SELECT 1 FROM documents_fts WHERE documents_fts MATCH ? LIMIT 1").get(term)),
					);
					if (known.length >= 2) {
						args[node ? 1 : 0] = known.join(" AND ");
						rows = statement.all(...args) as SearchRow[];
						if (!rows.length) {
							args[node ? 1 : 0] = known.join(" OR ");
							rows = statement.all(...args) as SearchRow[];
						}
						broadened = rows.length > 0;
					}
				}
			}
			if (rows[0] && !broadened && !taskDestination) {
				const current = rows[0];
				const metadata = JSON.parse(current.metadata) as TerraformMetadata;
				const schema = current.anchor.startsWith("schema-")
					? current.anchor.slice(7).split("--")
					: metadata.schema_path;
				if (schema.length >= 3) {
					const suffix = schema.slice(-2).join(".");
					const siblingClauses = [
						"dest.provider_name=?",
						"dest.provider_type=?",
						"substr(dest.schema_path,-length(?))=?",
					];
					const siblingArgs: Array<string | number> = [
						metadata.provider_name,
						metadata.provider_type,
						`.${suffix}`,
						`.${suffix}`,
					];
					for (const filter of filters) {
						siblingClauses.push(
							"EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=dest.path AND f.facet=? AND f.value=?)",
						);
						siblingArgs.push(filter.key, filter.value);
					}
					if (node) {
						siblingClauses.push(
							"dest.path IN (WITH RECURSIVE descendants(id,path) AS (SELECT id,path FROM terraform_documents WHERE id=? UNION SELECT d.id,d.path FROM terraform_documents d JOIN descendants n ON d.parent_id=n.id) SELECT path FROM descendants)",
						);
						siblingArgs.push(node);
					}
					const siblings = db
						.query(
							`SELECT dest.path,dest.anchor,dest.schema_path FROM terraform_destinations dest WHERE ${siblingClauses.join(" AND ")} ORDER BY dest.schema_path LIMIT 100`,
						)
						.all(...siblingArgs) as Array<{ path: string; anchor: string; schema_path: string }>;
					for (const sibling of siblings) {
						const m = { ...metadata, schema_path: sibling.schema_path.split(".") };
						if (
							selectTerraformCandidate(
								[
									{
										path: current.path,
										anchor: current.anchor,
										metadata: { ...metadata, schema_path: schema },
										ranking: current.raw_score,
									},
									{
										path: sibling.path,
										anchor: sibling.anchor,
										metadata: { ...m, schema_path: sibling.schema_path.split(".") },
										ranking: current.raw_score * 0.5,
									},
								],
								false,
								search,
							) === "choices"
						) {
							const details = db
								.query(
									"SELECT td.metadata,s.heading,s.context_markdown markdown FROM terraform_documents td JOIN terraform_sections s ON s.path=td.path WHERE td.path=? AND s.anchor=?",
								)
								.get(sibling.path, sibling.anchor) as { metadata: string; heading: string; markdown: string };
							rows.push({
								...sibling,
								...details,
								metadata: JSON.stringify({
									...JSON.parse(details.metadata),
									schema_path: sibling.schema_path.split("."),
								}),
								raw_score: current.raw_score * 0.5,
								score: (current.raw_score * 0.5) / (1 + current.raw_score * 0.5),
							});
							broadened = true;
						}
					}
				}
			}
			if (setupAnchor && !unknownIdentifiers) {
				const setupClauses = ["td.provider_type='provider'", "td.provider_name='setup'", "s.anchor=?"];
				const setupArgs: Array<string | number> = [setupAnchor];
				for (const filter of filters) {
					setupClauses.push(
						"EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=td.path AND f.facet=? AND f.value=?)",
					);
					setupArgs.push(filter.key, filter.value);
				}
				if (node) {
					setupClauses.push(
						"td.id IN (WITH RECURSIVE descendants(id) AS (SELECT id FROM terraform_documents WHERE id=? UNION SELECT d.id FROM terraform_documents d JOIN descendants n ON d.parent_id=n.id) SELECT id FROM descendants)",
					);
					setupArgs.push(node);
				}
				rows = (
					db
						.query(
							`SELECT td.path,td.metadata,s.anchor,s.heading,s.context_markdown markdown FROM terraform_documents td JOIN terraform_sections s ON s.path=td.path WHERE ${setupClauses.join(" AND ")} ORDER BY td.path COLLATE BINARY LIMIT ?`,
						)
						.all(...setupArgs, limit) as SearchRow[]
				).map(row => ({ ...row, raw_score: 200, score: 200 / 201 }));
				broadened = false;
			}
			if (rows.length === 1 && rows[0]?.anchor === "section" && !taskDestination && !setupAnchor) {
				const parent = rows[0];
				const metadata = JSON.parse(parent.metadata) as TerraformMetadata;
				const choiceClauses = [
					"r.path=?",
					"r.anchor='section'",
					"r.type IN ('conflicts','choice')",
					"r.choice_group IS NOT NULL",
					"r.target_path!=r.path",
				];
				const choiceArgs: Array<string | number> = [parent.path];
				for (const filter of filters) {
					choiceClauses.push(
						"EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=td.path AND f.facet=? AND f.value=?)",
					);
					choiceArgs.push(filter.key, filter.value);
				}
				if (node) {
					choiceClauses.push(
						"td.id IN (WITH RECURSIVE descendants(id) AS (SELECT id FROM terraform_documents WHERE id=? UNION SELECT d.id FROM terraform_documents d JOIN descendants n ON d.parent_id=n.id) SELECT id FROM descendants)",
					);
					choiceArgs.push(node);
				}
				const alternatives = db
					.query(
						`SELECT td.path,td.metadata,s.anchor,s.heading,s.context_markdown markdown,r.choice_group,r.enforcement FROM terraform_relationships r JOIN terraform_documents td ON td.path=r.target_path JOIN terraform_sections s ON s.path=td.path AND s.anchor=r.target_anchor WHERE ${choiceClauses.join(" AND ")} ORDER BY r.choice_group,td.path COLLATE BINARY LIMIT 30`,
					)
					.all(...choiceArgs) as Array<SearchRow & { choice_group: string; enforcement: string }>;
				const groups = new Map<string, SearchRow[]>();
				const providerChoiceGroups = new Set<string>();
				for (const alternative of alternatives) {
					const target = JSON.parse(alternative.metadata) as TerraformMetadata;
					const directChild =
						target.schema_path.length === metadata.schema_path.length + 1 &&
						metadata.schema_path.every((part, index) => target.schema_path[index] === part);
					const siblingType =
						alternative.enforcement === "provider-choice" &&
						target.schema_path.length === metadata.schema_path.length &&
						target.schema_path.slice(0, -1).every((part, index) => metadata.schema_path[index] === part);
					if (!directChild && !siblingType) continue;
					if (siblingType) providerChoiceGroups.add(alternative.choice_group);
					const group = groups.get(alternative.choice_group) ?? (siblingType ? [parent] : []);
					if (!group.some(row => row.path === alternative.path && row.anchor === alternative.anchor))
						group.push(alternative);
					groups.set(alternative.choice_group, group);
				}
				const choices = [...groups.entries()]
					.filter(
						([key, group]) =>
							(!providerChoiceGroups.size || providerChoiceGroups.has(key)) &&
							group.length >= 2 &&
							group.length <= limit,
					)
					.map(([, group]) => group);
				if (choices.length === 1) {
					const choice = terraformNamedChoice(
						search,
						choices[0]!.map(row => JSON.parse(row.metadata) as TerraformMetadata),
					);
					rows = (choice === undefined ? choices[0]! : [choices[0]![choice]!]).map(row => ({
						...row,
						raw_score: parent.raw_score,
						score: parent.score,
					}));
					unresolvedChoice = choice === undefined;
				}
			}
			const uniqueRows = new Map<string, SearchRow>();
			for (const row of rows) {
				const key = `${row.path}#${row.anchor}`;
				const previous = uniqueRows.get(key);
				if (!previous || row.raw_score > previous.raw_score) uniqueRows.set(key, row);
			}
			rows = [...uniqueRows.values()].sort(
				(a, b) =>
					b.raw_score - a.raw_score ||
					(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
					(a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
			);
			const selection = selectTerraformCandidate(
				rows.map(r => ({
					path: r.path,
					anchor: r.anchor,
					metadata: JSON.parse(r.metadata) as TerraformMetadata,
					ranking: r.raw_score,
				})),
				broadened || unresolvedChoice,
				search,
			);
			const prefix = `${provenance}\n\n# Terraform search: ${search}\n${selection === "leaf" ? "Selected leaf; read its complete section before drafting." : rows.length ? "Narrowing choices; compare these candidates with the full request. Clarify only an unspecified role or branch." : "No results."}\n${broadened ? "Broader word matching was needed; verify candidates.\n" : ""}Scores are ranking values, not probabilities.`;
			const continuation = new URL(url.href);
			continuation.searchParams.set("node", node ?? "xcsh-docs:provider:xcsh:navigation");
			content = boundedTerraformResponse(
				prefix,
				rows.map(r => {
					const m = JSON.parse(r.metadata) as TerraformMetadata;
					return `## ${m.provider_type}: xcsh_${m.provider_name} — ${m.role}\nSchema path: ${m.schema_path.join(".") || "root"}\nScore: ${Number(r.score.toFixed(12))}\nRead: ${uri(r.path, r.anchor, "context")}\n${prerequisites(r.path, r.anchor)}\n${rewriteTerraformLinks(r.markdown, r.path).replace(/\s+/g, " ").slice(0, 100)}`;
				}),
				4096,
				`Refine: ${continuation.href}`,
			);
		} else if (node) {
			const selected = db.query("SELECT id,summary,path FROM terraform_documents WHERE id=?").get(node) as {
				id: string;
				summary: string;
				path: string;
			} | null;
			if (!selected) throw new Error("Terraform node not found");
			const cursor = url.searchParams.get("cursor") ?? "";
			if (cursor) safePath(cursor);
			const clauses = filters.map(
				() => "EXISTS(SELECT 1 FROM terraform_facets f WHERE f.path=d.path AND f.facet=? AND f.value=?)",
			);
			const rows = db
				.query(
					`SELECT d.id,d.path,d.summary FROM terraform_documents d WHERE d.parent_id=? AND d.path>? ${clauses.length ? `AND ${clauses.join(" AND ")}` : ""} ORDER BY d.path COLLATE BINARY LIMIT ?`,
				)
				.all(node, cursor, ...filters.flatMap(f => [f.key, f.value]), limit + 1) as Array<{
				id: string;
				path: string;
				summary: string;
			}>;
			const shown = rows.slice(0, limit);
			const next = new URL(url.href);
			if (shown.length) next.searchParams.set("cursor", shown.at(-1)!.path);
			content = boundedTerraformResponse(
				`${provenance}\n\n${selected.summary}\nRead: ${uri(selected.path, "", "hint")}`,
				shown.map(
					r =>
						`- ${r.summary}: xcsh://terraform-documentation/?node=${encodeURIComponent(r.id)}\n  Hint: ${uri(r.path, "", "hint")}`,
				),
				4096,
				rows.length > limit ? `Continue: ${next.href}` : "",
			);
		} else {
			content = `${provenance}\n\n# Offline Terraform documentation\n${this.assets.pin.document_count} Markdown documents from documentation/.\n\nSearch: xcsh://terraform-documentation/?search=<query>&provider_type=<type>&provider_name=<name>&role=<role>&category=<category>&capability=<capability>&task=<task>&limit=<1-10>\nFilters combine with AND. Default limit: five. Use exact facet values from inventory or returned links; provider_name omits the xcsh_ Terraform type prefix.\nFacets: ${facetNames.map(f => `xcsh://terraform-documentation/?facet=${f}`).join("\n")}\nNavigation: xcsh://terraform-documentation/?node=xcsh-docs%3Aprovider%3Axcsh%3Anavigation\nExact reads: xcsh://terraform-documentation/documentation/<path>/index.md#<heading-or-explicit-anchor>\nViews: view=hint (4 KiB), view=context (16 KiB, complete sections and continuations), view=full (complete read). Existing exact reads remain complete.\nGuidance reflects documented schema validation; it is not live-apply evidence.`;
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

export function terraformLinkPath(href: string, source: string): { path: string; anchor: string } | null {
	let target = href;
	if (/^https?:\/\//.test(href)) {
		const url = new URL(href);
		const base = "/terraform-provider-xcsh/";
		if (url.hostname !== "f5-sales-demo.github.io" || !url.pathname.startsWith(base)) return null;
		let relative = url.pathname.slice(base.length);
		if (relative.startsWith("_data/") || relative.endsWith(".json") || relative.endsWith(".txt")) return null;
		if (relative.endsWith("/") || !relative) relative += "index.md";
		target = `documentation/${relative}${url.hash}`;
	} else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href) || href.startsWith("//")) return null;
	const [relative, anchor = ""] = target.split("#");
	const resolved = relative?.startsWith("documentation/")
		? relative
		: relative
			? path.posix.normalize(path.posix.join(path.posix.dirname(source), relative))
			: source;
	if (!resolved.endsWith(".md")) return null;
	safePath(resolved);
	return { path: resolved, anchor };
}

export function rewriteTerraformLinks(markdown: string, source: string): string {
	return markdown.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (whole, title: string, href: string) => {
		const destination = terraformLinkPath(href, source);
		return destination
			? `[${title}](xcsh://terraform-documentation/${destination.path}${destination.anchor ? `#${destination.anchor}` : ""})`
			: whole;
	});
}
