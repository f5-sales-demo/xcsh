/**
 * Citation extraction — the "Sources" chips a surface shows under an answer.
 *
 * Neutral module ON PURPOSE. This used to live in `browser/chat-handler.ts`, whose
 * 14 imports would have dragged the whole browser chat stack into the RPC path when
 * `rpc-mode` needed the same extraction (#2420). One extractor, and one rule for
 * "which assistant message ends a turn", shared by every transport — a client
 * reimplementing either would drift (see the #2249 trailing-markup regression).
 */
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import type { ChatReference } from "./browser/chat-protocol";

export function classifyReferenceKind(url: string): "doc" | "console" {
	try {
		const parsed = new URL(url);
		if (/\.console\.ves\.volterra\.io$/.test(parsed.hostname)) return "console";
		if (parsed.hostname === "docs.cloud.f5.com" || parsed.pathname.startsWith("/docs")) return "doc";
	} catch {
		/* malformed URL — default to doc */
	}
	return "doc";
}
function titleFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const segments = parsed.pathname.split("/").filter(Boolean);
		return segments.length > 0 ? segments[segments.length - 1] : parsed.hostname;
	} catch {
		return url;
	}
}
/**
 * Trailing characters a bare-URL match may greedily swallow at a markdown/prose
 * boundary — markdown emphasis + code (`*_~` and backtick) and sentence/wrap
 * punctuation. A real URL effectively never ends in these, so trimming them yields
 * the intended link (e.g. `**https://…/llms.txt**` or a code-wrapped
 * `` `https://…/llms.txt` `` → `https://…/llms.txt`). The markdown-link branch is
 * bounded by its closing `)` and needs no trimming.
 */
function trimTrailingMarkup(url: string): string {
	return url.replace(/[*_~`,.;:!?'")\]}>]+$/, "");
}
export function extractReferences(msg: AssistantMessage): ChatReference[] {
	const refs: ChatReference[] = [];
	const seen = new Set<string>();

	// STRUCTURED CITATIONS FIRST (#2340): a provider-side search reports the real page title, so
	// it beats the regex scrape below — which can only guess a title from the URL path, and finds
	// nothing at all when the model cites a source without printing its URL in the prose. Done as
	// its own pass so a citation in a later block still wins over a scrape in an earlier one.
	for (const block of msg.content) {
		if (block.type !== "text" || !block.citations) continue;
		for (const citation of block.citations) {
			const url = citation.url;
			if (!url || seen.has(url)) continue;
			seen.add(url);
			refs.push({
				kind: classifyReferenceKind(url),
				title: citation.title?.trim() || titleFromUrl(url),
				url,
			});
		}
	}

	for (const block of msg.content) {
		if (block.type !== "text") continue;

		const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
		for (let match = mdLinkRegex.exec(block.text); match !== null; match = mdLinkRegex.exec(block.text)) {
			const [, title, url] = match;
			if (seen.has(url)) continue;
			seen.add(url);
			refs.push({ kind: classifyReferenceKind(url), title, url });
		}

		const bareUrlRegex = /(?<!\()(https?:\/\/[^\s)>\]]+)/g;
		for (let match = bareUrlRegex.exec(block.text); match !== null; match = bareUrlRegex.exec(block.text)) {
			const url = trimTrailingMarkup(match[1]);
			if (seen.has(url)) continue;
			seen.add(url);
			refs.push({ kind: classifyReferenceKind(url), title: titleFromUrl(url), url });
		}
	}
	return refs;
}

/** The RPC stream's citation event, mirroring `chat_done.references` on the bridge. */
export interface RpcReferencesEvent {
	type: "references";
	references: ChatReference[];
}

/**
 * Decide whether an agent event should produce a citation event, and build it.
 *
 * Pure so the TURN-BOUNDARY rule is testable: an intermediate tool-use step also
 * emits `message_end`, and treating that as terminal is the trap
 * `chat-handler.ts` documents at length — it would publish the citations of a
 * half-finished answer (and, on the bridge, end the turn early). Returns null for
 * anything that is not a settled assistant message, and for a turn that cited
 * nothing, so callers emit only real content.
 *
 * Typed by what it CONSUMES (a tagged event that may carry a message) rather than by
 * one event union: the bridge and the RPC session stream different unions
 * (`AgentEvent` vs `AgentSessionEvent`) and both must be able to call this.
 */
export function referencesEventFor(event: { type: string; message?: unknown }): RpcReferencesEvent | null {
	if (event.type !== "message_end") return null;
	const message = (event as { message?: { role?: string } }).message;
	if (message?.role !== "assistant") return null;
	const assistant = message as AssistantMessage;
	// Intermediate tool-use step — the turn continues after the tool round-trip.
	if (assistant.stopReason === "toolUse" || assistant.content.some(part => part.type === "toolCall")) return null;
	const references = extractReferences(assistant);
	return references.length > 0 ? { type: "references", references } : null;
}
