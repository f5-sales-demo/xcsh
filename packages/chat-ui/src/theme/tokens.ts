/**
 * The single typed source of the F5 xcsh-terminal look, shared by every surface
 * (Office add-in, VS Code extension, Chrome extension).
 *
 * COLORS is GENERATED from the canonical xcsh CLI theme
 * (`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`) via
 * `scripts/gen-tokens.ts`, so there is no hand-transcription to drift. The
 * glyphs, font stack, and the CSS-injection helpers live here.
 *
 * Framework-free + host-agnostic: no React, no `chrome`/Office globals. Font URL
 * resolution is injected by each host (`chrome.runtime.getURL` / `asWebviewUri` /
 * a relative dev path) via the `getUrl` parameter; the default is the identity
 * resolver so the module never touches a host-specific global.
 */
export { COLORS, type ColorName } from "./colors.generated";

import { COLORS } from "./colors.generated";

export const GLYPHS = {
	assistant: "●",
	thinking: "✻",
	system: "※",
	userGutter: "π",
	userBar: "┃",
	prompt: "❯",
	cursor: "▏",
	thinkingLevels: ["◔", "◑", "◒", "◕", "◉"],
} as const;

// MesloLGS NF — the Powerlevel10k single-width Nerd Font. Each host bundles the
// four weights in a bundler-visible assets dir and resolves their URLs via the
// `getUrl` seam below. The named fallbacks cover the `font-display:swap` window.
export const FONT_STACK = "'MesloLGS NF', 'JetBrains Mono', ui-monospace, Menlo, monospace";

/** The four bundled MesloLGS NF weights (paths relative to a host `fonts/` dir). */
export const FONT_FACES = [
	{ file: "fonts/MesloLGS-NF-Regular.ttf", weight: "normal", style: "normal" },
	{ file: "fonts/MesloLGS-NF-Bold.ttf", weight: "bold", style: "normal" },
	{ file: "fonts/MesloLGS-NF-Italic.ttf", weight: "normal", style: "italic" },
	{ file: "fonts/MesloLGS-NF-Bold-Italic.ttf", weight: "bold", style: "italic" },
] as const;

const FONTFACE_ID = "xcsh-fontface";
const STYLE_ID = "xcsh-tokens";

/** Identity resolver — the default. Hosts override with their own URL scheme. */
function identityUrl(path: string): string {
	return path;
}

/** The `@font-face` block registering all bundled MesloLGS NF weights. */
export function fontFaceCss(getUrl: (p: string) => string = identityUrl): string {
	return FONT_FACES.map(
		f =>
			`@font-face { font-family: 'MesloLGS NF'; font-style: ${f.style}; font-weight: ${f.weight};` +
			` font-display: swap; src: url('${getUrl(f.file)}') format('truetype'); }`,
	).join("\n");
}

/** Register the bundled Nerd Font once (idempotent) at the DOCUMENT level.
 * `@font-face` rules do NOT resolve inside a ShadowRoot, so this only targets a
 * Document's `<head>` (falling back to `<html>`). */
export function injectFontFaces(doc: Document, getUrl: (p: string) => string = identityUrl): void {
	const head = doc.head ?? doc.documentElement;
	if (!head || head.querySelector(`#${FONTFACE_ID}`)) return;
	const style = doc.createElement("style");
	style.id = FONTFACE_ID;
	style.textContent = fontFaceCss(getUrl);
	head.append(style);
}

function kebab(k: string): string {
	return k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
}

/**
 * Two non-palette UI colors the panel stylesheet needs but the generated
 * palette (from xcsh-dark.json) deliberately does not carry: the near-black
 * code-block background (darker than any palette token) and pure white (crisp
 * on the F5-red fills, distinct from the off-white `brightWhite`). Kept here so
 * panel.css.ts stays fully token-driven (no literal colors).
 */
export const UI_COLORS = {
	codeBg: "#05070a",
	pureWhite: "#ffffff",
} as const;

/** A `:root{…}` block of `--<kebab-color>` custom properties + shared metrics. */
export function cssVars(): string {
	const lines = Object.entries(COLORS).map(([k, v]) => `  --${kebab(k)}: ${v};`);
	for (const [k, v] of Object.entries(UI_COLORS)) lines.push(`  --${kebab(k)}: ${v};`);
	lines.push(`  --font-mono: ${FONT_STACK};`);
	lines.push("  --gutter: 2ch;");
	return `:root {\n${lines.join("\n")}\n}`;
}

/** Insert the token stylesheet once into a Document or ShadowRoot (idempotent).
 * A Document cannot accept element children directly, so we mount into `<head>`
 * (falling back to `<html>`); a ShadowRoot is itself a valid mount point.
 * `nodeType === 9` (DOCUMENT_NODE) discriminates because `instanceof Document`
 * is unreliable across realms/test DOMs. */
export function injectTokens(root: Document | ShadowRoot): void {
	const isDocument = root.nodeType === 9;
	const mount: ParentNode | null = isDocument
		? ((root as Document).head ?? (root as Document).documentElement)
		: (root as ShadowRoot);
	if (!mount) return;
	if (mount.querySelector(`#${STYLE_ID}`)) return;
	const doc = isDocument ? (root as Document) : (root as ShadowRoot).ownerDocument;
	if (!doc) return;
	const style = doc.createElement("style");
	style.id = STYLE_ID;
	style.textContent = cssVars();
	mount.append(style);
}
