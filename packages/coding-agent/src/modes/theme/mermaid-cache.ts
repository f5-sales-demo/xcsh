import {
	extractMermaidBlocks,
	logger,
	type MermaidAsciiRenderOptions,
	type MermaidColorMode,
	mermaidSourceExceedsLimit,
	pickColorMode,
	renderMermaidAsciiSafe,
	tintMermaidNodes,
} from "@f5-sales-demo/pi-utils";
import { buildMermaidAsciiTheme, buildNodeAccents } from "./mermaid-palette";
import type { Theme } from "./theme";

// Keyed by `${sourceHash}|${themeSignature}` so a theme switch re-renders rather
// than serving a stale, differently-colored diagram.
const cache = new Map<string, string | null>();

let onRenderNeeded: (() => void) | null = null;

/** Set callback to trigger a TUI re-render when new mermaid renders become available. */
export function setMermaidRenderCallback(callback: (() => void) | null): void {
	onRenderNeeded = callback;
}

function colorModeFor(theme: Theme, override?: MermaidColorMode): MermaidColorMode {
	if (override) return override;
	return pickColorMode({ noColor: Boolean(Bun.env.NO_COLOR), trueColor: theme.getColorMode() === "truecolor" });
}

function paletteSignature(theme: Theme): string {
	return `${JSON.stringify(buildMermaidAsciiTheme(theme))}|${buildNodeAccents(theme).join(",")}`;
}

/** Stable signature identifying a theme's mermaid appearance — used for cache keying. */
export function mermaidThemeSignature(theme: Theme): string {
	return `${colorModeFor(theme)}:${paletteSignature(theme)}`;
}

export interface RenderMermaidThemedOptions {
	/** Force a color mode (otherwise derived from the theme + NO_COLOR). */
	colorMode?: MermaidColorMode;
	/** Extra layout options (padding, useAscii, …). */
	render?: MermaidAsciiRenderOptions;
	/**
	 * Available content width. When set (and paddingX isn't overridden), node spacing
	 * is expanded toward this width so the diagram uses the available space instead of
	 * rendering tiny — capped so small diagrams don't sprawl.
	 */
	targetWidth?: number;
}

const DEFAULT_PADDING_X = 2;
const DEFAULT_PADDING_Y = 1;
// Candidate horizontal spacings (ascending). Widening paddingX grows width WITHOUT
// growing height, so we can use much of the terminal; capped so a tiny diagram
// doesn't sprawl into absurdly long edges on a very wide terminal.
const PADDING_X_CANDIDATES = [1, 2, 4, 6, 8, 10, 12, 16, 20, 24];

/** Largest candidate paddingX whose rendered width still fits targetWidth (>= smallest). */
function pickPaddingXForWidth(source: string, targetWidth: number): number {
	let best = PADDING_X_CANDIDATES[0]!;
	for (const px of PADDING_X_CANDIDATES) {
		const out = renderMermaidAsciiSafe(source, { colorMode: "none", paddingX: px, paddingY: DEFAULT_PADDING_Y });
		if (out == null) break;
		let w = 0;
		for (const line of out.split("\n")) w = Math.max(w, Bun.stringWidth(line));
		if (w <= targetWidth) best = px;
		else break; // wider candidates only grow; stop early (also avoids costly large-padding renders)
	}
	return best;
}

/**
 * Render mermaid source to a themed, per-node-tinted ASCII/Unicode string.
 * Applies the theme's per-role palette, then the best-effort node-tint pass.
 * Result is memoized per (source, theme, colorMode). Returns null on parse failure.
 */
export function renderMermaidThemed(source: string, theme: Theme, opts?: RenderMermaidThemedOptions): string | null {
	// Oversized graphs can hang the synchronous pathfinder for tens of seconds; skip
	// them so the display falls back to the raw code block instead of freezing the UI.
	if (mermaidSourceExceedsLimit(source)) return null;

	const mode = colorModeFor(theme, opts?.colorMode);
	const baseRender = opts?.render ?? {};
	// Resolve horizontal spacing: explicit override wins; else expand toward the target
	// width (capped) so the diagram uses the space; else the compact default.
	const paddingX =
		baseRender.paddingX ??
		(opts?.targetWidth !== undefined ? pickPaddingXForWidth(source, opts.targetWidth) : DEFAULT_PADDING_X);
	const renderOpts: MermaidAsciiRenderOptions = { paddingY: DEFAULT_PADDING_Y, ...baseRender, paddingX };

	// Layout options change the output, so they must be part of the key — but the
	// compact DEFAULT is treated as "no options" so the key still matches
	// mermaidThemeSignature()/getMermaidAscii() (the inline prerender/lookup path).
	const sigObj: Record<string, unknown> = { ...renderOpts };
	if (sigObj.paddingX === DEFAULT_PADDING_X) delete sigObj.paddingX;
	if (sigObj.paddingY === DEFAULT_PADDING_Y) delete sigObj.paddingY;
	const optsSig = Object.keys(sigObj).length > 0 ? `|${JSON.stringify(sigObj)}` : "";
	const key = `${Bun.hash(source.trim())}|${mode}:${paletteSignature(theme)}${optsSig}`;
	const cached = cache.get(key);
	if (cached !== undefined) return cached;

	const asciiTheme = buildMermaidAsciiTheme(theme);
	const colored = renderMermaidAsciiSafe(source, { ...renderOpts, colorMode: mode, theme: asciiTheme });
	if (colored == null) {
		cache.set(key, null);
		return null;
	}
	const result = mode === "none" ? colored : tintMermaidNodes(colored.split("\n"), buildNodeAccents(theme)).join("\n");
	cache.set(key, result);
	return result;
}

/** Get a pre-rendered mermaid diagram by source hash + theme signature, or null. */
export function getMermaidAscii(hash: bigint | number, themeSig: string): string | null {
	return cache.get(`${hash}|${themeSig}`) ?? null;
}

/** Render and cache every mermaid block in `markdown` for the given theme. */
export function prerenderMermaid(markdown: string, theme: Theme): void {
	const blocks = extractMermaidBlocks(markdown);
	if (blocks.length === 0) return;

	const sig = mermaidThemeSignature(theme);
	let hasNew = false;
	for (const { source, hash } of blocks) {
		if (cache.has(`${hash}|${sig}`)) continue;
		if (renderMermaidThemed(source, theme) != null) hasNew = true;
	}

	if (hasNew && onRenderNeeded) {
		try {
			onRenderNeeded();
		} catch (error) {
			logger.warn("Mermaid render callback failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

/** Check whether `markdown` has mermaid blocks not yet cached for this theme. */
export function hasPendingMermaid(markdown: string, themeSig: string): boolean {
	const blocks = extractMermaidBlocks(markdown);
	return blocks.some(({ hash }) => !cache.has(`${hash}|${themeSig}`));
}

/** Clear the mermaid cache. */
export function clearMermaidCache(): void {
	cache.clear();
}
