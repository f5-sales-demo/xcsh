/**
 * Minimal, XSS-safe markdown → HTML for assistant messages. PURE (returns a
 * string; no DOM, no deps). Promoted from the Chrome extension's
 * `markdown-render.ts`; the escaped allow-list approach is the canonical
 * reconciliation of Chrome's renderer and the VS Code marked+DOMPurify path —
 * it needs no runtime dependency and stays browser-safe.
 *
 * Escaping is load-bearing: the result is set via `innerHTML`, so we escape
 * everything first, then re-introduce a tiny allow-list (bold, italics, inline
 * code, fenced code, links). Links are http(s)/mailto only and always open in a
 * new tab with rel=noopener.
 */
export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function isSafeUrl(url: string): boolean {
	try {
		const u = new URL(url, "https://base.invalid");
		return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:";
	} catch {
		return false;
	}
}

export function renderMarkdown(md: string): string {
	// 1) fenced code blocks → placeholders (so inline rules don't touch them)
	const blocks: string[] = [];
	let s = md.replace(/```([\s\S]*?)```/g, (_m, code: string) => {
		blocks.push(`<pre class="code"><code>${escapeHtml(code.replace(/^\n/, ""))}</code></pre>`);
		return `BLOCKPLACEHOLDER${blocks.length - 1}BLOCKPLACEHOLDER`;
	});

	// 2) escape the rest
	s = escapeHtml(s);

	// 3) inline code — `c` is drawn from the already-escaped string; do NOT escape again.
	s = s.replace(/`([^`]+)`/g, (_m, c: string) => `<code>${c}</code>`);

	// 4) links [text](url) — url was escaped; decode for the safety check only.
	s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, rawUrl: string) => {
		const url = rawUrl.replace(/&amp;/g, "&");
		if (!isSafeUrl(url)) return text;
		return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
	});

	// 5) bold then italics
	s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

	// 6) newlines → <br>
	s = s.replace(/\n/g, "<br>");

	// 7) restore code blocks. Fallback to the matched token when the index is out
	//    of range (e.g. a forged token in user text) so we never leak "undefined".
	s = s.replace(/BLOCKPLACEHOLDER(\d+)BLOCKPLACEHOLDER/g, (_m, idx: string) => {
		return blocks[Number.parseInt(idx, 10)] ?? _m;
	});
	return s;
}
