/**
 * Map the active xcsh UI theme onto a mermaid `AsciiTheme`. The palette is
 * deliberately restrained and professional: neutral gray structure with a single
 * F5-brand accent on the arrowheads — no rainbow of per-node colors. Reading the
 * theme keeps it dark/light adaptive and on-brand.
 */
import type { MermaidAsciiRenderOptions } from "@f5xc-salesdemos/pi-utils";
import type { Theme } from "./theme";

type AsciiTheme = NonNullable<MermaidAsciiRenderOptions["theme"]>;

/**
 * Restrained per-role palette — neutral grays for the diagram structure, with one
 * brand accent on the arrowheads:
 *   labels  → neutral text gray
 *   borders → soft gray
 *   edges   → dim gray (recede behind the boxes)
 *   arrows  → F5 brand accent (the single pop of color)
 * Nodes render uniformly (see buildNodeAccents — no per-node tint).
 */
export function buildMermaidAsciiTheme(theme: Theme): AsciiTheme {
	return {
		fg: theme.getFgHex("toolOutput", "#9ca3b0"), // node + edge labels
		border: theme.getFgHex("muted", "#9ca3b0"), // node + subgraph borders
		line: theme.getFgHex("dim", "#6b7280"), // edge lines — subtle
		arrow: theme.getFgHex("accent", "#ca260a"), // arrowheads — single brand accent
		corner: theme.getFgHex("dim", "#6b7280"),
		junction: theme.getFgHex("muted", "#9ca3b0"),
	};
}

/**
 * Per-node accent colors for the tint pass. Intentionally EMPTY: a professional
 * diagram reads as one consistent palette, not a different bright hue per box.
 * With no accents, the tint pass is a no-op and nodes use the role colors above.
 */
export function buildNodeAccents(_theme: Theme): string[] {
	return [];
}
