/**
 * "Sources" chip row — the references the assistant cited (F5 docs pages and
 * tenant-console deep links), surfaced beneath its answer for scannability.
 * Parity with Claude for Office's References affordance.
 *
 * Each chip is a safe external link: URLs are gated through the same `isSafeUrl`
 * the markdown sanitizer uses, so a non-http(s) URL renders as inert text rather
 * than a clickable `javascript:`/`data:` sink. References are deduped by URL.
 */
import { isSafeUrl } from "../markdown/render";
import type { ChatReference } from "../types";

export interface ReferenceChipsProps {
	references: ChatReference[];
}

/** Kind → short tag glyph, kept in the terminal aesthetic (no emoji). */
const KIND_TAG: Record<ChatReference["kind"], string> = { doc: "DOC", console: "CON" };

export function ReferenceChips({ references }: ReferenceChipsProps) {
	// Dedupe by URL, preserving first-seen order.
	const seen = new Set<string>();
	const unique = references.filter(r => {
		if (seen.has(r.url)) return false;
		seen.add(r.url);
		return true;
	});
	if (unique.length === 0) return null;

	// Semantic <ul>/<li> (not role="list") — the anchor inside each <li> keeps its
	// native `link` role, and the list a11y comes free from the element itself.
	return (
		<ul className="references" aria-label="Sources">
			{unique.map(r => {
				const tag = (
					<span className="ref-tag" aria-hidden="true">
						{KIND_TAG[r.kind]}
					</span>
				);
				return (
					<li key={r.url} className="ref-item">
						{isSafeUrl(r.url) ? (
							<a className={`ref-chip ref-${r.kind}`} href={r.url} target="_blank" rel="noopener noreferrer">
								{tag}
								<span className="ref-title">{r.title}</span>
								<span className="ref-ext" aria-hidden="true">
									↗
								</span>
							</a>
						) : (
							// Unsafe URLs are shown as inert text — never a clickable sink.
							<span className={`ref-chip ref-${r.kind} ref-unsafe`}>
								{tag}
								<span className="ref-title">{r.title}</span>
							</span>
						)}
					</li>
				);
			})}
		</ul>
	);
}
