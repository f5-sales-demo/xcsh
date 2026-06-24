/**
 * Mermaid color helpers — terminal color-mode selection, diagram-type detection,
 * and a best-effort per-node tint pass for ASCII/Unicode mermaid output.
 *
 * `beautiful-mermaid` colorizes strictly by global character role (text/border/
 * line/arrow/…), so per-node hues are not reachable through its API. `tintMermaidNodes`
 * adds them as a post-pass: it detects node-box rectangles in the rendered output and
 * overrides the foreground color of each box's border + label cells with a cycled accent.
 * It is intentionally fail-safe — any ambiguity returns the input unchanged so the
 * library's per-role coloring still shows through.
 */

/** Color mode subset we drive `beautiful-mermaid` with. */
export type MermaidColorMode = "none" | "ansi256" | "truecolor";

export interface ColorModeInput {
	/** NO_COLOR set, output piped, or color explicitly disabled. */
	noColor: boolean;
	/** Terminal advertises 24-bit color. */
	trueColor: boolean;
}

/** Choose the richest color mode the environment robustly supports. */
export function pickColorMode({ noColor, trueColor }: ColorModeInput): MermaidColorMode {
	if (noColor) return "none";
	return trueColor ? "truecolor" : "ansi256";
}

/**
 * Complexity ceiling for mermaid sources. beautiful-mermaid's ASCII edge router
 * (A* pathfinder) can allocate unbounded memory and hang for tens of seconds —
 * then throw `RangeError: Out of memory` — on large/dense graphs. Callers should
 * reject sources past this limit BEFORE rendering rather than attempt the layout.
 */
export const MERMAID_MAX_CHARS = 20000;
export const MERMAID_MAX_LINES = 400;

/** True when a mermaid source is too large to render safely (see limits above). */
export function mermaidSourceExceedsLimit(source: string): boolean {
	if (source.length > MERMAID_MAX_CHARS) return true;
	let lines = 1;
	for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10 && ++lines > MERMAID_MAX_LINES) return true;
	return false;
}

export type MermaidDiagramType = "flowchart" | "sequence" | "class" | "er" | "state" | "xychart" | "unknown";

/** Detect the diagram type from the first meaningful header line of mermaid source. */
export function detectDiagramType(source: string): MermaidDiagramType {
	for (const raw of source.split("\n")) {
		const line = raw.trim();
		// Skip blanks, YAML frontmatter fences, %%{init}%% directives, and %% comments.
		if (line === "" || line === "---" || line.startsWith("%%")) continue;
		// Skip frontmatter key/value lines (anything before we hit a known header).
		if (/^(graph|flowchart)\b/.test(line)) return "flowchart";
		if (/^sequenceDiagram\b/.test(line)) return "sequence";
		if (/^classDiagram(-v2)?\b/.test(line)) return "class";
		if (/^erDiagram\b/.test(line)) return "er";
		if (/^stateDiagram(-v2)?\b/.test(line)) return "state";
		if (/^xychart(-beta)?\b/.test(line)) return "xychart";
		// A header-shaped token that isn't recognized → give up (avoid matching frontmatter values).
		if (/^[A-Za-z]/.test(line) && !line.includes(":")) return "unknown";
	}
	return "unknown";
}

// ── per-node tint pass ──────────────────────────────────────────────────────

interface Cell {
	char: string;
	/** Active foreground SGR sequence ("" = default). */
	fg: string;
}

interface Rect {
	top: number;
	left: number;
	bottom: number;
	right: number;
}

const TL = new Set(["┌", "╭", "+"]);
const isH = (ch: string): boolean => ch === "─" || ch === "-";
const isV = (ch: string): boolean => ch === "│" || ch === "|";
// Borders may carry an edge-attachment junction (a tee/cross) where an edge meets
// the box; accept those so attached nodes are still detected and tinted.
const isHBorder = (ch: string): boolean => isH(ch) || ch === "┬" || ch === "┴" || ch === "┼";
const isVBorder = (ch: string): boolean => isV(ch) || ch === "├" || ch === "┤" || ch === "┼";

/** Parse a colored line into per-visible-cell {char, fg}, tracking the active fg color. */
function parseCells(line: string): Cell[] {
	const cells: Cell[] = [];
	let fg = "";
	const re = /\x1b\[[0-9;]*m/g;
	let last = 0;
	for (let m = re.exec(line); m !== null; m = re.exec(line)) {
		for (const ch of line.slice(last, m.index)) cells.push({ char: ch, fg });
		fg = nextFg(fg, m[0]);
		last = re.lastIndex;
	}
	for (const ch of line.slice(last)) cells.push({ char: ch, fg });
	return cells;
}

/** Compute the new active fg from an SGR sequence (only fg-affecting codes matter). */
function nextFg(prev: string, seq: string): string {
	const params = seq.slice(2, -1); // strip ESC[ and trailing m
	if (params === "" || params === "0") return "";
	if (params.startsWith("38;2;") || params.startsWith("38;5;")) return seq;
	if (params === "39") return "";
	if (/^(3[0-7]|9[0-7])$/.test(params)) return seq;
	return prev; // bold/underline/bg/etc. — leave fg unchanged
}

/** Locate a single rectangle whose top-left corner is at (r,c), or null. */
function readRect(grid: string[][], r: number, c: number): Rect | null {
	const tl = grid[r]?.[c];
	if (tl === undefined || !TL.has(tl)) return null;
	const ascii = tl === "+";
	const trCh = ascii ? "+" : tl === "╭" ? "╮" : "┐";
	const blCh = ascii ? "+" : tl === "╭" ? "╰" : "└";
	const brCh = ascii ? "+" : tl === "╭" ? "╯" : "┘";

	const row = grid[r]!;
	let right = -1;
	for (let x = c + 1; x < row.length; x++) {
		const ch = row[x]!;
		if (ch === trCh) {
			right = x;
			break;
		}
		if (!isHBorder(ch)) break;
	}
	if (right < c + 2) return null; // need interior width

	let bottom = -1;
	for (let y = r + 1; y < grid.length; y++) {
		const ch = grid[y]?.[c];
		if (ch === undefined) break;
		if (ch === blCh) {
			bottom = y;
			break;
		}
		if (!isVBorder(ch)) break;
	}
	if (bottom < r + 2) return null; // need interior height

	if (grid[bottom]?.[right] !== brCh) return null;
	// Verify bottom edge and right edge (junctions where edges attach are allowed).
	for (let x = c + 1; x < right; x++) if (!isHBorder(grid[bottom]?.[x] ?? "")) return null;
	for (let y = r + 1; y < bottom; y++) if (!isVBorder(grid[y]?.[right] ?? "")) return null;

	return { top: r, left: c, bottom, right };
}

function findRects(grid: string[][]): Rect[] {
	const rects: Rect[] = [];
	for (let r = 0; r < grid.length; r++) {
		const row = grid[r]!;
		for (let c = 0; c < row.length; c++) {
			if (TL.has(row[c]!)) {
				const rect = readRect(grid, r, c);
				if (rect) rects.push(rect);
			}
		}
	}
	return rects;
}

function contains(a: Rect, b: Rect): boolean {
	if (a === b) return false;
	return a.top <= b.top && a.left <= b.left && a.bottom >= b.bottom && a.right >= b.right;
}

/**
 * Tint each node box a cycled accent color. `coloredLines` is the role-colored
 * mermaid render; `accentsAnsi` is a list of fg SGR escapes to cycle across nodes.
 * Returns the input unchanged if no boxes are found or no accents are given.
 */
export function tintMermaidNodes(coloredLines: string[], accentsAnsi: string[]): string[] {
	if (accentsAnsi.length === 0) return coloredLines;
	try {
		const rows = coloredLines.map(parseCells);
		const grid = rows.map(cells => cells.map(cell => cell.char));
		const rects = findRects(grid);
		if (rects.length === 0) return coloredLines;

		// Nodes are the innermost rectangles (a subgraph frame contains others → skip it).
		const nodes = rects
			.filter(rect => !rects.some(other => contains(rect, other)))
			.sort((p, q) => p.top - q.top || p.left - q.left);
		if (nodes.length === 0) return coloredLines;

		// overrides: "r,c" → accent fg sequence.
		const overrides = new Map<string, string>();
		nodes.forEach((rect, i) => {
			const accent = accentsAnsi[i % accentsAnsi.length]!;
			for (let x = rect.left; x <= rect.right; x++) {
				overrides.set(`${rect.top},${x}`, accent);
				overrides.set(`${rect.bottom},${x}`, accent);
			}
			for (let y = rect.top; y <= rect.bottom; y++) {
				overrides.set(`${y},${rect.left}`, accent);
				overrides.set(`${y},${rect.right}`, accent);
				for (let x = rect.left + 1; x < rect.right; x++) {
					if ((grid[y]?.[x] ?? " ") !== " ") overrides.set(`${y},${x}`, accent);
				}
			}
		});

		return rows.map((cells, r) => {
			const hasOverride = cells.some((_, c) => overrides.has(`${r},${c}`));
			if (!hasOverride) return coloredLines[r]!;
			let out = "";
			let lastFg = "";
			for (let c = 0; c < cells.length; c++) {
				const cell = cells[c]!;
				const fg = overrides.get(`${r},${c}`) ?? cell.fg;
				if (fg !== lastFg) {
					out += fg === "" ? "\x1b[39m" : fg;
					lastFg = fg;
				}
				out += cell.char;
			}
			if (lastFg !== "") out += "\x1b[0m";
			return out;
		});
	} catch {
		return coloredLines;
	}
}
