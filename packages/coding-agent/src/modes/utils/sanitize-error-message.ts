import { Ellipsis, truncateToWidth } from "@f5-sales-demo/pi-tui";

/**
 * Single-line-safe sanitizer for error messages rendered inside TUI status
 * footers (e.g. `(error: <message>)`). Protects the layout from payloads that
 * contain ANSI escape sequences, embedded newlines, tabs, other control
 * characters, wide glyphs (CJK / emoji), or are simply too long to fit on
 * one terminal row.
 *
 * Contract (applied in order):
 *   1. Full ANSI escape sequences (CSI like `\x1b[31m`, OSC like
 *      `\x1b]8;;...\x1b\\`, and single-byte ESC introducers) are removed
 *      WHOLE — not just the lone ESC byte — so no `[31mboom[0m` garbage
 *      survives.
 *   2. Embedded newlines and tabs are collapsed to a single space.
 *   3. Any remaining ASCII control characters (\x00–\x1F and \x7F) are
 *      stripped.
 *   4. Runs of whitespace are collapsed to a single space; leading/trailing
 *      whitespace is trimmed.
 *   5. Output is truncated to {@link MAX_ERROR_MESSAGE_WIDTH} **terminal
 *      cells** (not UTF-16 code units) via `truncateToWidth` from pi-tui;
 *      wide glyphs therefore count as 2 cells each. Truncation is marked
 *      with a single horizontal ellipsis (`…`). The limit is chosen so
 *      that `(error: <msg>)` (9-cell wrapper) fits on a single row of an
 *      80-column terminal.
 */

// Sanitized-message budget for the `(error: <msg>)` footer.
//
// The footer is rendered inside GutterBlock (2-cell prefix) + the bash/
// python execution box (which reserves a 1-cell Text indent on each side
// plus a further gap on the right before wrapping occurs in practice).
// Arithmetic gives ~68 cells on an 80-column terminal, but empirical
// rendering with `createToolGutter(new BashExecutionComponent(...)).render(80)`
// still wraps the trailing `)` onto the next row at that ceiling.
// Pin the budget well inside the algebraic limit so the guarantee holds
// under the real layered layout.
//
// Net budget for the message: 60 cells → full footer ≤ ~73 cells →
// safe on any terminal ≥ 80 columns even after the gutter + box overhead.
export const MAX_ERROR_MESSAGE_WIDTH = 60;

// Matches CSI (Control Sequence Introducer) / SGR sequences: \x1b[ … final byte.
const ANSI_CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// Matches OSC (Operating System Command) sequences: \x1b] … terminator (BEL or ESC\).
const ANSI_OSC_RE = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
// Fallback for any stray single-byte ESC sequences (e.g. "\x1bM" reverse index).
const ANSI_ESC_RE = /\x1b[@-_]?/g;

export function sanitizeErrorMessage(raw: string): string {
	const withoutAnsi = raw.replace(ANSI_OSC_RE, "").replace(ANSI_CSI_RE, "").replace(ANSI_ESC_RE, "");
	// Collapse whitespace-like control chars (tab, newline, CR, form feed)
	// to a single space, then strip every remaining control character.
	const flattened = withoutAnsi.replace(/[\t\n\r\f\v]+/g, " ").replace(/[\x00-\x1F\x7F]/g, "");
	const collapsed = flattened.replace(/\s+/g, " ").trim();
	// truncateToWidth measures in terminal cells (wide glyphs count as 2)
	// and appends an ellipsis when it clips. Returns the input unchanged if
	// already within budget.
	return truncateToWidth(collapsed, MAX_ERROR_MESSAGE_WIDTH, Ellipsis.Unicode);
}
