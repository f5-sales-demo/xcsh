import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import {
	API_PUBLIC_CATEGORIES,
	API_PUBLIC_DOMAINS,
	API_PUBLIC_OPERATIONS,
	GENERAL_PUBLIC_DOCUMENTS,
	PUBLIC_CITATION_SOURCES,
	TERRAFORM_PUBLIC_DOCUMENTS,
} from "./public-citation-destinations.generated";

export type DocumentationCitationCorpus = "documentation" | "terraform" | "api";

/** A read target and its separately verified, human-readable publication target. */
export interface DocumentationCitationDestination {
	readonly readUri: string;
	readonly publicUrl: string;
	readonly title: string;
	readonly corpus: DocumentationCitationCorpus;
	readonly sourceVersion: string;
	readonly sourceDigest: string;
	readonly sectionLevelLinkAvailable: boolean;
}

export interface DocumentationCitationFailure {
	readonly readUri: string;
	readonly reason: "missing-public-mapping" | "conflicting-public-mapping" | "conflicting-source-version";
}

export type DocumentationCitationResolver = (
	readUri: string,
) => DocumentationCitationDestination | DocumentationCitationFailure | null;

const DOCUMENTATION_HOSTS = new Set([
	"docs",
	"documentation",
	"terraform-documentation",
	"terraform",
	"api-spec",
	"api-catalog",
]);
const PROVIDER_PAGES = "https://f5-sales-demo.github.io/terraform-provider-xcsh/";

function destination(
	readUri: string,
	publicUrl: string,
	title: string,
	corpus: DocumentationCitationCorpus,
): DocumentationCitationDestination {
	const source = PUBLIC_CITATION_SOURCES[corpus === "documentation" ? "general" : corpus];
	return {
		readUri,
		publicUrl,
		title,
		corpus,
		sourceVersion: source.version,
		sourceDigest: `sha256:${source.digest}`,
		// The current public sites publish document routes. Their source anchors are
		// not published as equivalent section or operation anchors.
		sectionLevelLinkAvailable: false,
	};
}

function terraformDestination(
	readUri: string,
	path: string,
): DocumentationCitationDestination | DocumentationCitationFailure {
	const title = TERRAFORM_PUBLIC_DOCUMENTS[path];
	if (!title) return { readUri, reason: "missing-public-mapping" };
	const route = path.slice("documentation/".length, -"index.md".length);
	return destination(readUri, `${PROVIDER_PAGES}${route}`, title, "terraform");
}

export function publicCitationForInternalUri(
	readUri: string,
): DocumentationCitationDestination | DocumentationCitationFailure | null {
	let url: URL;
	try {
		url = new URL(readUri);
	} catch {
		return null;
	}
	if (url.protocol !== "xcsh:" || !DOCUMENTATION_HOSTS.has(url.hostname)) return null;
	let pathname: string;
	try {
		pathname = decodeURIComponent(url.pathname).replace(/^\//, "");
	} catch {
		return { readUri, reason: "missing-public-mapping" };
	}
	if (pathname.includes("\\") || pathname.split("/").some(part => part === "." || part === ".."))
		return { readUri, reason: "missing-public-mapping" };
	if (url.hostname === "docs") return { readUri, reason: "missing-public-mapping" };
	if (url.hostname === "documentation") {
		const key = pathname.replace(/\/index\.md$/, "");
		const document = GENERAL_PUBLIC_DOCUMENTS[key];
		return document
			? destination(readUri, document.url, document.title, "documentation")
			: { readUri, reason: "missing-public-mapping" };
	}
	if (url.hostname === "terraform-documentation") {
		if (!pathname.startsWith("documentation/") || !pathname.endsWith("/index.md"))
			return { readUri, reason: "missing-public-mapping" };
		return terraformDestination(readUri, pathname);
	}
	if (url.hostname === "terraform") {
		return terraformDestination(readUri, `documentation/${pathname}/index.md`);
	}
	if (url.hostname === "api-spec") {
		const domain = pathname.split("/")[0];
		const page = API_PUBLIC_DOMAINS[domain];
		return page ? destination(readUri, page.url, page.title, "api") : { readUri, reason: "missing-public-mapping" };
	}
	const domain = API_PUBLIC_CATEGORIES[pathname];
	if (!domain) return { readUri, reason: "conflicting-public-mapping" };
	const page = API_PUBLIC_DOMAINS[domain];
	return page ? destination(readUri, page.url, page.title, "api") : { readUri, reason: "missing-public-mapping" };
}

function citationKey(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== "xcsh:" || !DOCUMENTATION_HOSTS.has(url.hostname)) return null;
		return `${url.hostname}${url.pathname}${url.hash}`;
	} catch {
		return null;
	}
}

function citationCorpus(value: string): DocumentationCitationCorpus | null {
	try {
		const host = new URL(value).hostname;
		if (host === "documentation") return "documentation";
		if (host === "terraform-documentation" || host === "terraform") return "terraform";
		if (host === "api-spec" || host === "api-catalog") return "api";
	} catch {
		/* unrelated URL */
	}
	return null;
}

function publishedUrlForCorpus(value: string, corpus: DocumentationCitationCorpus): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") return false;
		if (corpus === "terraform")
			return (
				url.hostname === "f5-sales-demo.github.io" &&
				url.pathname.startsWith("/terraform-provider-xcsh/") &&
				!url.pathname.includes("/_data/")
			);
		if (corpus === "api")
			return (
				url.hostname === "f5-sales-demo.github.io" && url.pathname.startsWith("/api-specs-enriched/api-reference/")
			);
		return ["community.f5.com", "docs.cloud.f5.com", "my.f5.com", "www.f5.com"].includes(url.hostname);
	} catch {
		return false;
	}
}

/** A session's trusted internal reads bind citations to the source version that produced them. */
export class SessionCitationRegistry {
	readonly #mappings = new Map<string, DocumentationCitationDestination | DocumentationCitationFailure>();
	readonly #versions = new Map<DocumentationCitationCorpus, string>();

	constructor(messages: readonly AgentMessage[] = []) {
		for (const message of messages) this.observe(message);
	}

	observe(message: AgentMessage): void {
		if (message.role !== "toolResult" || message.toolName !== "read" || message.isError) return;
		const source = message.details?.meta?.source as { type?: unknown; value?: unknown } | undefined;
		if (source?.type !== "internal" || typeof source.value !== "string") return;
		const corpus = citationCorpus(source.value);
		if (!corpus) return;
		const text = message.content
			.filter(part => part.type === "text")
			.map(part => part.text)
			.join("\n");
		const snapshot = /^Snapshot:\s*`?([^\s`]+)`?/m.exec(text)?.[1];
		const apiVersion = corpus === "api" ? /^Source:\s*(v\d+\.\d+\.\d+)/m.exec(text)?.[1] : undefined;
		const apiHeading =
			corpus === "api" ? /^# F5 XC API (?:Catalog|Specifications) \(v(\d+\.\d+\.\d+)\)/m.exec(text)?.[1] : undefined;
		const citedVersion =
			/(content-\d{8}T\d{6}Z|documentation-v\d+\.\d+\.\d+|v\d+\.\d+\.\d+),\s*sha256:[a-f0-9]{64}/.exec(text)?.[1];
		const observed = snapshot ?? apiVersion ?? (apiHeading ? `v${apiHeading}` : undefined) ?? citedVersion;
		if (observed) {
			const prior = this.#versions.get(corpus);
			this.#versions.set(corpus, prior && prior !== observed ? "conflict" : observed);
		} else if (!this.#versions.has(corpus)) this.#versions.set(corpus, "unknown");
		const lines = text.split("\n");
		const pairs: Array<{ read: string; cite: string }> = [];
		for (let index = 0; index < lines.length - 1; index++) {
			const read = /^\s*(?:-\s*)?Read:\s*`?(xcsh:\/\/[^\s`]+)`?\s*$/.exec(lines[index]!);
			const cite = /^\s*(?:-\s*)?Cite:\s*(https:\/\/[^\s)]+)/.exec(lines[index + 1]!);
			if (read && cite) pairs.push({ read: read[1]!, cite: lines[index + 1]! });
		}
		if (pairs.length === 0 && /^Cite:\s*https:\/\//.test(lines[0] ?? ""))
			pairs.push({ read: source.value, cite: lines[0]! });
		for (const pair of pairs) this.#add(pair.read, pair.cite, corpus, observed);
	}

	#add(readUri: string, line: string, corpus: DocumentationCitationCorpus, observed?: string): void {
		if (citationCorpus(readUri) !== corpus) return;
		const key = citationKey(readUri);
		const publicUrl = /\bCite:\s*(https:\/\/[^\s)]+)/.exec(line)?.[1];
		if (!key || !publicUrl || !publishedUrlForCorpus(publicUrl, corpus)) return;
		const staticResult = publicCitationForInternalUri(readUri);
		if (!staticResult || !("publicUrl" in staticResult) || staticResult.publicUrl !== publicUrl) return;
		const provenance =
			/(content-\d{8}T\d{6}Z|documentation-v\d+\.\d+\.\d+|v\d+\.\d+\.\d+),\s*(sha256:[a-f0-9]{64})/.exec(line);
		const current = PUBLIC_CITATION_SOURCES[corpus === "documentation" ? "general" : corpus];
		const sourceVersion = provenance?.[1] ?? observed ?? current.version;
		const sourceDigest =
			provenance?.[2] ?? (sourceVersion === current.version ? `sha256:${current.digest}` : undefined);
		if (!sourceDigest) return;
		const next: DocumentationCitationDestination = {
			readUri,
			publicUrl,
			title: staticResult.title,
			corpus,
			sourceVersion,
			sourceDigest,
			sectionLevelLinkAvailable: false,
		};
		const previous = this.#mappings.get(key);
		if (
			previous &&
			("reason" in previous ||
				previous.publicUrl !== next.publicUrl ||
				previous.sourceVersion !== next.sourceVersion ||
				previous.sourceDigest !== next.sourceDigest)
		) {
			this.#mappings.set(key, { readUri, reason: "conflicting-public-mapping" });
			return;
		}
		this.#mappings.set(key, next);
	}

	resolve: DocumentationCitationResolver = readUri => {
		const key = citationKey(readUri);
		const bound = key ? this.#mappings.get(key) : undefined;
		if (bound) return { ...bound, readUri };
		const fallback = publicCitationForInternalUri(readUri);
		if (!fallback) return null;
		const corpus = citationCorpus(readUri);
		if (corpus) {
			const observed = this.#versions.get(corpus);
			const current = PUBLIC_CITATION_SOURCES[corpus === "documentation" ? "general" : corpus].version;
			if (observed && observed !== current) return { readUri, reason: "conflicting-source-version" };
		}
		return fallback;
	};
}

/** Exact method/path/operationId matching prevents a similarly named API operation from becoming a citation. */
export function publicCitationForApiOperation(
	readUri: string,
	method: string,
	path: string,
	operationId: string,
): DocumentationCitationDestination | DocumentationCitationFailure {
	const normalizedPath = path.replace(/\{(?:metadata|system_metadata)\.(namespace|name)\}/g, "{$1}");
	const domain = API_PUBLIC_OPERATIONS[JSON.stringify([method.toUpperCase(), normalizedPath, operationId])];
	if (!domain) return { readUri, reason: "conflicting-public-mapping" };
	const page = API_PUBLIC_DOMAINS[domain];
	return page ? destination(readUri, page.url, page.title, "api") : { readUri, reason: "missing-public-mapping" };
}

export function citationLine(
	result: DocumentationCitationDestination | DocumentationCitationFailure,
	includeProvenance = true,
): string {
	return "publicUrl" in result
		? `Cite: ${result.publicUrl} (document page; section link unavailable${includeProvenance ? `; ${result.sourceVersion}, ${result.sourceDigest}` : ""})`
		: `Cite: unavailable (${result.reason}; no verified public destination)`;
}

const DOC_URI =
	/xcsh:\/\/(?:docs|documentation|terraform-documentation|terraform|api-spec|api-catalog)(?![A-Za-z0-9.-])(?:[/?#][^\s<>)\]}`]*)?/gi;

/** Project assistant prose only. Tool inputs, tool results, fenced code, and inline protocol examples stay exact. */
export function normalizeAssistantDocumentationCitations(
	text: string,
	resolve: DocumentationCitationResolver = publicCitationForInternalUri,
): string {
	let fenced = false;
	return text
		.split(/(?<=\n)/)
		.map(line => {
			if (/^\s*(?:`{3,}|~{3,})/.test(line)) {
				fenced = !fenced;
				return line;
			}
			if (fenced) return line;
			return line
				.split(/(`[^`]*`)/g)
				.map((segment, index) => {
					if (index % 2 === 1) return segment;
					return segment.replace(DOC_URI, raw => {
						const trailing = /[.,;:!?]+$/.exec(raw)?.[0] ?? "";
						const uri = trailing ? raw.slice(0, -trailing.length) : raw;
						const mapped = resolve(uri);
						if (!mapped) return raw;
						return ("publicUrl" in mapped ? mapped.publicUrl : "[unverified documentation citation]") + trailing;
					});
				})
				.join("");
		})
		.join("");
}

/** Hold an unfinished word or link until a boundary makes its citation URL safe to display. */
export class DocumentationCitationStream {
	#raw = "";
	#visible = "";
	static readonly #prefix = "xcsh://";
	constructor(private readonly resolve: DocumentationCitationResolver = publicCitationForInternalUri) {}

	#pendingUrlStart(): number | null {
		const lowerRaw = this.#raw.toLowerCase();
		const full = lowerRaw.lastIndexOf(DocumentationCitationStream.#prefix);
		if (full >= 0) {
			const tail = this.#raw.slice(full);
			if (!/[\s<>)\]}`"']/.test(tail)) {
				const hostAndPath = tail.slice(DocumentationCitationStream.#prefix.length);
				const host = hostAndPath.split("/", 1)[0]!.toLowerCase();
				if (DOCUMENTATION_HOSTS.has(host) || [...DOCUMENTATION_HOSTS].some(value => value.startsWith(host)))
					return full;
			}
		}
		for (let length = 1; length < DocumentationCitationStream.#prefix.length; length++) {
			const start = this.#raw.length - length;
			if (
				lowerRaw.endsWith(DocumentationCitationStream.#prefix.slice(0, length)) &&
				(start === 0 || /[^A-Za-z0-9]/.test(this.#raw[start - 1]!))
			)
				return start;
		}
		return null;
	}

	get visible(): string {
		return this.#visible;
	}

	push(delta: string): string {
		this.#raw += delta;
		const pendingStart = this.#pendingUrlStart();
		const projected = normalizeAssistantDocumentationCitations(
			pendingStart === null ? this.#raw : this.#raw.slice(0, pendingStart),
			this.resolve,
		);
		if (!projected.startsWith(this.#visible)) return "";
		const safe = projected.slice(this.#visible.length);
		this.#visible = projected;
		return safe;
	}

	complete(): string {
		const projected = normalizeAssistantDocumentationCitations(this.#raw, this.resolve);
		const rest = projected.startsWith(this.#visible) ? projected.slice(this.#visible.length) : "";
		this.#visible = projected;
		return rest;
	}
}

/** This projection is repeatable, so saved evidence can remain byte-for-byte unchanged. */
export function projectAssistantDocumentationCitations(
	message: AssistantMessage,
	resolve: DocumentationCitationResolver = publicCitationForInternalUri,
): AssistantMessage {
	let changed = false;
	const content = message.content.map(block => {
		if (block.type !== "text") return block;
		const normalized = normalizeAssistantDocumentationCitations(block.text, resolve);
		const citations = block.citations?.flatMap(citation => {
			const mapped = resolve(citation.url);
			if (!mapped) return [citation];
			changed = true;
			return "publicUrl" in mapped
				? [{ ...citation, url: mapped.publicUrl, title: citation.title || mapped.title }]
				: [];
		});
		if (normalized === block.text && citations === undefined) return block;
		if (normalized !== block.text) changed = true;
		return { ...block, text: normalized, ...(citations === undefined ? {} : { citations }) };
	});
	return changed ? { ...message, content } : message;
}

export function projectDocumentationTranscript(messages: readonly AgentMessage[]): AgentMessage[] {
	const registry = new SessionCitationRegistry();
	return messages.map(message => {
		registry.observe(message);
		return message.role === "assistant" ? projectAssistantDocumentationCitations(message, registry.resolve) : message;
	});
}
