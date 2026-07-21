#!/usr/bin/env bun
/**
 * Generate `src/theme/colors.generated.ts` FROM the canonical xcsh CLI theme
 * (`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`), so the
 * shared chat-ui palette can never drift from the product's source of truth.
 *
 * Usage:
 *   bun scripts/gen-tokens.ts            # (re)write the generated file
 *   bun scripts/gen-tokens.ts --check    # exit 1 if the committed file is stale (CI)
 *
 * COLORS = every entry in the theme's `vars`, plus the two semantic colors the
 * chat UI needs that live under `colors` rather than `vars` (chromeAccent, dim).
 */
import * as fs from "node:fs";
import * as path from "node:path";

const THEME_JSON = path.resolve(
	import.meta.dir,
	"..",
	"..",
	"coding-agent",
	"src",
	"modes",
	"theme",
	"defaults",
	"xcsh-dark.json",
);
const OUT = path.resolve(import.meta.dir, "..", "src", "theme", "colors.generated.ts");

/** Semantic colors promoted from `colors` (they are hex literals, not in `vars`). */
const EXTRA_FROM_COLORS = ["chromeAccent", "dim"] as const;

interface ThemeJson {
	vars: Record<string, string>;
	colors: Record<string, string | number>;
}

function build(): string {
	const theme = JSON.parse(fs.readFileSync(THEME_JSON, "utf8")) as ThemeJson;
	const entries: Array<[string, string]> = [];
	for (const [k, v] of Object.entries(theme.vars)) {
		if (!v.startsWith("#")) throw new Error(`xcsh-dark.json vars.${k} is not a hex color: ${v}`);
		entries.push([k, v]);
	}
	for (const k of EXTRA_FROM_COLORS) {
		const v = theme.colors[k];
		if (typeof v !== "string" || !v.startsWith("#")) {
			throw new Error(`xcsh-dark.json colors.${k} must be a hex string`);
		}
		entries.push([k, v]);
	}
	const body = entries.map(([k, v]) => `\t${k}: "${v}",`).join("\n");
	return [
		"// GENERATED — do not edit by hand.",
		"// Source of truth: packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json",
		"// Regenerate: `bun scripts/gen-tokens.ts` (CI runs `--check` and fails on drift).",
		"export const COLORS = {",
		body,
		"} as const;",
		"",
		"export type ColorName = keyof typeof COLORS;",
		"",
	].join("\n");
}

const generated = build();
if (process.argv.includes("--check")) {
	const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
	if (current !== generated) {
		console.error("src/theme/colors.generated.ts is stale — run: bun scripts/gen-tokens.ts");
		process.exit(1);
	}
	console.log("colors.generated.ts is up to date.");
} else {
	fs.writeFileSync(OUT, generated);
	console.log(`Wrote ${OUT}`);
}
