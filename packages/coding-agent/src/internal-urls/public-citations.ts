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
	readonly reason: "missing-public-mapping" | "conflicting-public-mapping";
}

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
	const pathname = url.pathname.replace(/^\//, "");
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
	/xcsh:\/\/(?:docs|documentation|terraform-documentation|terraform|api-spec|api-catalog)\/[^\s<>)\]}`]+/g;

/** Project assistant prose only. Tool inputs, tool results, fenced code, and inline protocol examples stay exact. */
export function normalizeAssistantDocumentationCitations(text: string): string {
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
						const mapped = publicCitationForInternalUri(uri);
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

	#pendingUrlStart(): number | null {
		const full = this.#raw.lastIndexOf(DocumentationCitationStream.#prefix);
		if (full >= 0) {
			const tail = this.#raw.slice(full);
			if (!/[\s<>)\]}`"']/.test(tail)) {
				const hostAndPath = tail.slice(DocumentationCitationStream.#prefix.length);
				const host = hostAndPath.split("/", 1)[0]!;
				if (DOCUMENTATION_HOSTS.has(host) || [...DOCUMENTATION_HOSTS].some(value => value.startsWith(host)))
					return full;
			}
		}
		for (let length = 1; length < DocumentationCitationStream.#prefix.length; length++) {
			const start = this.#raw.length - length;
			if (
				this.#raw.endsWith(DocumentationCitationStream.#prefix.slice(0, length)) &&
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
		);
		if (!projected.startsWith(this.#visible)) return "";
		const safe = projected.slice(this.#visible.length);
		this.#visible = projected;
		return safe;
	}

	complete(): string {
		const projected = normalizeAssistantDocumentationCitations(this.#raw);
		const rest = projected.startsWith(this.#visible) ? projected.slice(this.#visible.length) : "";
		this.#visible = projected;
		return rest;
	}
}

/** This projection is repeatable, so saved evidence can remain byte-for-byte unchanged. */
export function projectAssistantDocumentationCitations(message: AssistantMessage): AssistantMessage {
	let changed = false;
	const content = message.content.map(block => {
		if (block.type !== "text") return block;
		const normalized = normalizeAssistantDocumentationCitations(block.text);
		const citations = block.citations?.flatMap(citation => {
			const mapped = publicCitationForInternalUri(citation.url);
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
	return messages.map(message =>
		message.role === "assistant" ? projectAssistantDocumentationCitations(message) : message,
	);
}
