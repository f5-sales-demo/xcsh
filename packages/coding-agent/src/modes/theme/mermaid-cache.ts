import {
	extractMermaidBlocks,
	logger,
	type MermaidAsciiRenderOptions,
	type MermaidColorMode,
	pickColorMode,
	renderMermaidAsciiSafe,
	tintMermaidNodes,
} from "@f5xc-salesdemos/pi-utils";
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
}

/**
 * Render mermaid source to a themed, per-node-tinted ASCII/Unicode string.
 * Applies the theme's per-role palette, then the best-effort node-tint pass.
 * Result is memoized per (source, theme, colorMode). Returns null on parse failure.
 */
export function renderMermaidThemed(source: string, theme: Theme, opts?: RenderMermaidThemedOptions): string | null {
	const mode = colorModeFor(theme, opts?.colorMode);
	// Layout options (useAscii, padding, …) change the output, so they must be part
	// of the key. Omitted when absent so the key matches mermaidThemeSignature() —
	// the no-options form used by the inline-markdown prerender/lookup path.
	const optsSig = opts?.render && Object.keys(opts.render).length > 0 ? `|${JSON.stringify(opts.render)}` : "";
	const key = `${Bun.hash(source.trim())}|${mode}:${paletteSignature(theme)}${optsSig}`;
	const cached = cache.get(key);
	if (cached !== undefined) return cached;

	const asciiTheme = buildMermaidAsciiTheme(theme);
	const colored = renderMermaidAsciiSafe(source, { ...opts?.render, colorMode: mode, theme: asciiTheme });
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
