/**
 * Map the active xcsh UI theme onto a mermaid `AsciiTheme` (per-role hues) and a
 * cycling list of node-accent ANSI escapes for the per-node tint pass. Reading the
 * theme keeps diagrams on-brand and dark/light adaptive.
 */
import type { MermaidAsciiRenderOptions } from "@f5xc-salesdemos/pi-utils";
import type { Theme } from "./theme";

type AsciiTheme = NonNullable<MermaidAsciiRenderOptions["theme"]>;

/**
 * Per-role color palette: red node borders, gold labels, blue edges, green
 * arrowheads. These show through wherever the per-node tint pass doesn't apply
 * (edges, arrows, subgraph frames, and as the fallback when tinting is skipped).
 */
export function buildMermaidAsciiTheme(theme: Theme): AsciiTheme {
	return {
		fg: theme.getFgHex("mdHeading", "#febc38"), // node/edge labels
		border: theme.getFgHex("accent", "#ca260a"), // node + subgraph borders
		line: theme.getFgHex("mdLink", "#0088fa"), // edge lines
		arrow: theme.getFgHex("success", "#00ff88"), // arrowheads
		corner: theme.getFgHex("mdLink", "#0088fa"),
		junction: theme.getFgHex("accent", "#ca260a"),
	};
}

/**
 * ANSI foreground escapes cycled across detected node boxes so each node reads as
 * a distinct hue. Drawn from vivid, well-separated theme roles.
 */
export function buildNodeAccents(theme: Theme): string[] {
	const roles = ["chromeAccent", "success", "warning", "mdLink", "accent"] as const;
	const seen = new Set<string>();
	const accents: string[] = [];
	for (const role of roles) {
		const ansi = theme.getFgAnsi(role);
		if (!seen.has(ansi)) {
			seen.add(ansi);
			accents.push(ansi);
		}
	}
	return accents;
}
