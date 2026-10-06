import { createHash } from "node:crypto";
import type { DocumentationSource } from "./documentation-resolve";

export const DOCUMENTATION_CONTENT_TYPES = [
	"product_overview",
	"solution_overview",
	"concept",
	"how_to",
	"reference",
	"knowledge_article",
] as const;
export type DocumentationContentType = (typeof DOCUMENTATION_CONTENT_TYPES)[number];

export const DOCUMENTATION_TASK_TYPES = ["concept", "configure", "troubleshoot", "support", "reference"] as const;
export type DocumentationTaskType = (typeof DOCUMENTATION_TASK_TYPES)[number];

export const DOCUMENTATION_LIFECYCLES = ["current", "deprecated", "superseded"] as const;
export type DocumentationLifecycle = (typeof DOCUMENTATION_LIFECYCLES)[number];

export interface DocumentationRelatedDocument {
	readonly relation: DocumentationTaskType;
	readonly title: string;
	readonly canonicalUrl: string;
	readonly source: DocumentationSource;
	readonly stablePath: string;
}

export interface DocumentationMetadata {
	readonly metadataSchema: 1;
	readonly product: string | null;
	readonly contentType: DocumentationContentType;
	readonly taskType: DocumentationTaskType;
	readonly canonicalUrl: string;
	readonly lastUpdated: string | null;
	readonly language: string;
	readonly aliases: readonly string[];
	readonly lifecycle: DocumentationLifecycle;
	readonly replacementUrl: string | null;
	readonly relatedDocuments: readonly DocumentationRelatedDocument[];
}

export interface DocumentationPassage {
	readonly anchor: string;
	readonly heading: string;
	readonly markdown: string;
	readonly ordinal: number;
}

export interface DocumentationGraphNode {
	readonly source: DocumentationSource;
	readonly stablePath: string;
	readonly title: string;
	readonly metadata: DocumentationMetadata;
}

const CONTENT_TYPE_SET = new Set<string>(DOCUMENTATION_CONTENT_TYPES);
const TASK_TYPE_SET = new Set<string>(DOCUMENTATION_TASK_TYPES);
const LIFECYCLE_SET = new Set<string>(DOCUMENTATION_LIFECYCLES);
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const PRODUCT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_PATH = /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/;
const SOURCE_SET = new Set<DocumentationSource>(["community-f5-com", "docs-cloud-f5-com", "my-f5-com", "www-f5-com"]);

function record(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
	return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
	return value;
}

function nullableDate(value: unknown, field: string): string | null {
	if (value === null) return null;
	const result = nonEmpty(value, field);
	const parsed = new Date(`${result}T00:00:00Z`);
	if (
		result.length !== 10 ||
		!DATE.test(result) ||
		Number.isNaN(parsed.valueOf()) ||
		parsed.toISOString().slice(0, 10) !== result
	)
		throw new Error(`${field} is invalid`);
	return result;
}

function sortedStrings(value: unknown, field: string): readonly string[] {
	if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) {
		throw new Error(`${field} must contain non-empty strings`);
	}
	const result = value as string[];
	const expected = [...new Set(result)].sort((left, right) =>
		compareText(left.toLocaleLowerCase("en-US"), right.toLocaleLowerCase("en-US")),
	);
	if (JSON.stringify(result) !== JSON.stringify(expected)) throw new Error(`${field} must be sorted and deduplicated`);
	return result;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function parseDocumentationMetadata(
	value: Record<string, unknown>,
	validateUrl: (value: unknown, source: DocumentationSource | undefined, field: string) => string,
	source: DocumentationSource,
	field: string,
): DocumentationMetadata {
	if (value.metadata_schema !== 1) throw new Error(`${field}.metadata_schema must be 1`);
	const product = value.product;
	if (product !== null && (typeof product !== "string" || !PRODUCT.test(product))) {
		throw new Error(`${field}.product must be a stable slug or null`);
	}
	const contentType = nonEmpty(value.content_type, `${field}.content_type`);
	if (!CONTENT_TYPE_SET.has(contentType)) throw new Error(`${field}.content_type is invalid`);
	const taskType = nonEmpty(value.task_type, `${field}.task_type`);
	if (!TASK_TYPE_SET.has(taskType)) throw new Error(`${field}.task_type is invalid`);
	const canonicalUrl = validateUrl(value.canonical_url, source, `${field}.canonical_url`);
	const lastUpdated = nullableDate(value.last_updated, `${field}.last_updated`);
	const language = nonEmpty(value.language, `${field}.language`);
	if (!LANGUAGE.test(language)) throw new Error(`${field}.language is invalid`);
	const aliases = sortedStrings(value.aliases, `${field}.aliases`);
	const lifecycle = nonEmpty(value.lifecycle, `${field}.lifecycle`);
	if (!LIFECYCLE_SET.has(lifecycle)) throw new Error(`${field}.lifecycle is invalid`);
	const replacementUrl =
		value.replacement_url === null ? null : validateUrl(value.replacement_url, undefined, `${field}.replacement_url`);
	if ((lifecycle === "superseded") !== (replacementUrl !== null)) {
		throw new Error(`${field}.replacement_url must exist only for superseded documents`);
	}
	if (!Array.isArray(value.related_documents)) throw new Error(`${field}.related_documents must be a list`);
	const relatedDocuments = value.related_documents.map((item, position) => {
		const relation = record(item, `${field}.related_documents[${position}]`);
		const relationType = nonEmpty(relation.relation, `${field}.related_documents[${position}].relation`);
		if (!TASK_TYPE_SET.has(relationType))
			throw new Error(`${field}.related_documents[${position}].relation is invalid`);
		const relatedSource = nonEmpty(
			relation.source_id,
			`${field}.related_documents[${position}].source_id`,
		) as DocumentationSource;
		if (!SOURCE_SET.has(relatedSource))
			throw new Error(`${field}.related_documents[${position}].source_id is invalid`);
		const stablePath = nonEmpty(relation.stable_path, `${field}.related_documents[${position}].stable_path`);
		if (!SAFE_PATH.test(stablePath))
			throw new Error(`${field}.related_documents[${position}].stable_path is invalid`);
		return {
			relation: relationType as DocumentationTaskType,
			title: nonEmpty(relation.title, `${field}.related_documents[${position}].title`),
			canonicalUrl: validateUrl(
				relation.canonical_url,
				relatedSource,
				`${field}.related_documents[${position}].canonical_url`,
			),
			source: relatedSource,
			stablePath,
		};
	});
	const relatedOrder = [...relatedDocuments].sort(
		(left, right) =>
			compareText(left.relation, right.relation) ||
			compareText(left.title.toLocaleLowerCase("en-US"), right.title.toLocaleLowerCase("en-US")) ||
			compareText(left.canonicalUrl, right.canonicalUrl) ||
			compareText(left.source, right.source) ||
			compareText(left.stablePath, right.stablePath),
	);
	if (JSON.stringify(relatedDocuments) !== JSON.stringify(relatedOrder)) {
		throw new Error(`${field}.related_documents must be sorted`);
	}
	if (new Set(relatedDocuments.map(item => item.canonicalUrl)).size !== relatedDocuments.length) {
		throw new Error(`${field}.related_documents must be deduplicated`);
	}
	return {
		metadataSchema: 1,
		product: product as string | null,
		contentType: contentType as DocumentationContentType,
		taskType: taskType as DocumentationTaskType,
		canonicalUrl,
		lastUpdated,
		language,
		aliases,
		lifecycle: lifecycle as DocumentationLifecycle,
		replacementUrl,
		relatedDocuments,
	};
}

export function githubHeadingAnchor(heading: string, occurrences: Map<string, number>): string {
	const base = heading
		.trim()
		.toLocaleLowerCase("en-US")
		.replace(/<[^>]*>/g, "")
		.replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
		.replace(/\s/g, "-");
	const normalized = base || "section";
	const count = occurrences.get(normalized) ?? 0;
	occurrences.set(normalized, count + 1);
	return count === 0 ? normalized : `${normalized}-${count}`;
}

export function splitHeadingPassages(body: string): readonly DocumentationPassage[] {
	const lines = body.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
	const headings: Array<{ line: number; heading: string; anchor: string }> = [];
	const occurrences = new Map<string, number>();
	let fence: string | undefined;
	for (const [line, value] of lines.entries()) {
		const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(value);
		if (fenceMatch) {
			const marker = fenceMatch[1]![0]!;
			if (!fence) fence = marker;
			else if (fence === marker) fence = undefined;
			continue;
		}
		if (fence) continue;
		const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(value);
		if (!match) continue;
		const heading = match[2]!.trim();
		headings.push({ line, heading, anchor: githubHeadingAnchor(heading, occurrences) });
	}
	if (headings.length === 0)
		return [{ anchor: "document", heading: "Document", markdown: `${body.trim()}\n`, ordinal: 0 }];
	return headings.map((heading, ordinal) => {
		const start = heading.line;
		const end = headings[ordinal + 1]?.line ?? lines.length;
		return {
			anchor: heading.anchor,
			heading: heading.heading,
			markdown: `${lines.slice(start, end).join("\n").trim()}\n`,
			ordinal,
		};
	});
}

export function passageHash(documentHash: string, anchor: string, markdown: string): string {
	return createHash("sha256").update(`${documentHash}\0${anchor}\0${markdown}`).digest("hex");
}

export function validateDocumentationGraph(documents: readonly DocumentationGraphNode[]): void {
	const canonicalGroups = new Map<string, DocumentationGraphNode[]>();
	for (const document of documents) {
		canonicalGroups.set(document.metadata.canonicalUrl, [
			...(canonicalGroups.get(document.metadata.canonicalUrl) ?? []),
			document,
		]);
	}
	const uniqueTargets = new Map(
		[...canonicalGroups]
			.filter(([, matches]) => matches.length === 1)
			.map(([url, matches]) => [url, matches[0]!] as const),
	);
	for (const document of documents) {
		if (document.metadata.replacementUrl !== null && !uniqueTargets.has(document.metadata.replacementUrl)) {
			throw new Error(`replacement target is missing or ambiguous: ${document.metadata.replacementUrl}`);
		}
		for (const related of document.metadata.relatedDocuments) {
			const target = uniqueTargets.get(related.canonicalUrl);
			if (!target) throw new Error(`related target is missing or ambiguous: ${related.canonicalUrl}`);
			if (
				target.source !== related.source ||
				target.stablePath !== related.stablePath ||
				target.title !== related.title ||
				target.metadata.taskType !== related.relation
			) {
				throw new Error(`related target metadata mismatch: ${related.canonicalUrl}`);
			}
			if (related.canonicalUrl === document.metadata.canonicalUrl) {
				throw new Error(`related target cannot reference itself: ${related.canonicalUrl}`);
			}
		}
	}
}
