/**
 * Streaming soft-close for markdown.
 *
 * Assistant text arrives token-by-token; `renderMarkdown` re-parses the whole
 * buffer on every `chat_delta`. Mid-stream, the trailing bytes are almost always
 * an UNCLOSED construct, and a naive re-parse flashes raw markup (a lone
 * ```` ``` ```` line as text, `| a | b |` header pipes as a paragraph) until the
 * closing bytes arrive. This module returns a RENDER-ONLY copy of the buffer with
 * those trailing constructs softly closed/held so each frame paints as the target
 * element. It NEVER mutates the stored transcript text — only what is fed to the
 * parser for this frame.
 *
 * Two rules, both deliberately STRICT so a completed document is a fixed point
 * (`softCloseForStreaming(final) === final` once nothing is dangling):
 *   1. Odd number of ```` ``` ```` fences → append one synthetic closing fence so
 *      an in-progress code block renders as `<pre>` immediately.
 *   2. A trailing partial GFM table — a `≥2`-cell header row followed by an
 *      INCOMPLETE delimiter row — is HELD (stripped) for this frame, so the header
 *      pipes never flash as prose. A lone prose line containing pipes
 *      (`use flag A | B`) has no following delimiter row and is therefore NEVER
 *      touched, and a COMPLETE delimiter row already parses as a table and is left
 *      alone.
 */

/** Count of ```` ``` ```` fence lines (≤3 leading spaces). Odd ⇒ inside a block. */
function openFenceCount(md: string): number {
	const matches = md.match(/^ {0,3}```/gm);
	return matches ? matches.length : 0;
}

/** Number of `|`-delimited cells in a table row (outer pipes ignored). */
function cellCount(line: string): number {
	const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
	return trimmed.split("|").length;
}

/** A row that could be a table HEADER: contains a pipe and yields ≥2 cells. */
function isPipeHeaderRow(line: string): boolean {
	return line.includes("|") && cellCount(line) >= 2;
}

/** Only delimiter glyphs (`| - : space`) with at least one dash — a delimiter-in-progress. */
function looksLikeDelimiterInProgress(line: string): boolean {
	return /^[\s|:-]*-[\s|:-]*$/.test(line) && line.trim().length > 0;
}

/**
 * A COMPLETE GFM delimiter row for a header of `headerCells` columns: every cell
 * matches `:?-+:?` and the column count agrees (so marked will render a table).
 */
function isCompleteDelimiterRow(line: string, headerCells: number): boolean {
	const cells = line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map(c => c.trim());
	return cells.length === headerCells && cells.every(c => /^:?-+:?$/.test(c));
}

/** Append a synthetic closing fence when an odd number of fences is open. */
function closeOpenFence(md: string): string {
	if (openFenceCount(md) % 2 === 1) {
		return `${md}\n\`\`\``;
	}
	return md;
}

/**
 * Strip a trailing `header + incomplete-delimiter` table so it does not flash as
 * prose. Operates on the last two non-empty lines; leaves everything else — prose
 * with pipes, and already-complete tables — untouched.
 */
function holdPartialTable(md: string): string {
	const lines = md.split("\n");
	// Ignore a single trailing empty line (a newline just typed after the delimiter).
	let end = lines.length;
	while (end > 0 && lines[end - 1].trim() === "") end--;
	if (end < 2) return md;

	const last = lines[end - 1];
	const prev = lines[end - 2];
	if (!isPipeHeaderRow(prev)) return md;
	if (!looksLikeDelimiterInProgress(last)) return md;
	// A complete delimiter (matching column count) is a real table — leave it.
	if (isCompleteDelimiterRow(last, cellCount(prev))) return md;

	return lines.slice(0, end - 2).join("\n");
}

/** Render-only soft-close of a streaming markdown buffer (see file header). */
export function softCloseForStreaming(md: string): string {
	return holdPartialTable(closeOpenFence(md));
}
