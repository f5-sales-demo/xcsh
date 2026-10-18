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
 *   1. An open fenced code token → append its matching container and delimiter so
 *      an in-progress code block renders as `<pre>` immediately.
 *   2. A trailing partial GFM table — a `≥2`-cell header row followed by an
 *      INCOMPLETE delimiter row — is HELD (stripped) for this frame, so the header
 *      pipes never flash as prose. A lone prose line containing pipes
 *      (`use flag A | B`) has no following delimiter row and is therefore NEVER
 *      touched, and a COMPLETE delimiter row already parses as a table and is left
 *      alone.
 */

import { Marked, type Token, type Tokens } from "marked";

const fenceLexer = new Marked({ gfm: true, async: false });

/** Use the lexer to respect inline/indented code and list/quote containers. */
function openFence(tokens: readonly Token[], prefix = ""): string | undefined {
	const token = tokens.findLast(token => token.type !== "space");
	if (!token) return undefined;
	if (token.type === "blockquote") return openFence(token.tokens ?? [], `${prefix}> `);
	if (token.type === "list") {
		const item = (token as Tokens.List).items.at(-1);
		if (!item) return undefined;
		const marker = /^( *)(?:[-+*]|\d+[.)])([ \t]+)/.exec(item.raw);
		return openFence(item.tokens, prefix + " ".repeat(marker?.[0].length ?? 2));
	}
	if (token.type !== "code" || token.codeBlockStyle === "indented") return undefined;
	const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(token.raw);
	if (!opening) return undefined;
	const delimiter = opening[1];
	const closing = new RegExp(`^ {0,3}${delimiter[0]}{${delimiter.length},}[ \t]*$`);
	if (
		token.raw
			.slice(opening[0].length)
			.split("\n")
			.some(line => closing.test(line))
	)
		return undefined;
	return prefix + delimiter;
}

/** Split only unescaped GFM pipes; outer empty cells are delimiters. */
function tableCells(line: string): string[] {
	const cells: string[] = [];
	let cell = "";
	let escaped = false;
	for (const char of line.trim()) {
		if (char === "|" && !escaped) {
			cells.push(cell.trim());
			cell = "";
		} else cell += char;
		escaped = char === "\\" && !escaped;
	}
	cells.push(cell.trim());
	if (cells[0] === "") cells.shift();
	if (cells.at(-1) === "") cells.pop();
	return cells;
}

function cellCount(line: string): number {
	return tableCells(line).length;
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
	const cells = tableCells(line);
	return cells.length === headerCells && cells.every(c => /^:?-+:?$/.test(c));
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
export function softCloseForStreaming(md: string, options: { closeCode?: boolean } = {}): string {
	const closing = openFence(fenceLexer.lexer(md));
	if (closing) return options.closeCode === false ? md : `${md}\n${closing}`;
	return holdPartialTable(md);
}
