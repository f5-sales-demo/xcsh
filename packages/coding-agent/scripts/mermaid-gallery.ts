#!/usr/bin/env bun
/**
 * F5 XC Mermaid — visual gallery harness for human UAT.
 *
 * Renders the F5 Distributed Cloud mermaid sample library through the real
 * display pipeline (themed per-role palette + per-node tint) so you can visually
 * inspect the colorized output in your own terminal and give feedback.
 *
 * Usage:
 *   bun scripts/mermaid-gallery.ts                       # all samples, dark theme, truecolor
 *   bun scripts/mermaid-gallery.ts --theme light
 *   bun scripts/mermaid-gallery.ts --color ansi256       # none | ansi256 | truecolor
 *   bun scripts/mermaid-gallery.ts --ascii               # ASCII box chars instead of Unicode
 *   bun scripts/mermaid-gallery.ts --type flowchart      # filter by diagram type
 *   bun scripts/mermaid-gallery.ts --filter waf          # regex over id/category/prompt
 *   bun scripts/mermaid-gallery.ts --list                # list samples, don't render
 *
 * Tip: pipe through `less -R` to page while keeping color.
 */
import type { MermaidColorMode } from "@f5-sales-demo/pi-utils";
import { renderMermaidThemed } from "../src/modes/theme/mermaid-cache";
import { getThemeByName } from "../src/modes/theme/theme";
import { XC_MERMAID_SAMPLES, type XcMermaidSample } from "../test/fixtures/xc-mermaid-samples";

interface Args {
	theme: string;
	color: MermaidColorMode;
	ascii: boolean;
	type?: string;
	filter?: RegExp;
	list: boolean;
}

function parseArgs(argv: string[]): Args {
	const args: Args = { theme: "xcsh-dark", color: "truecolor", ascii: false, list: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i] ?? "";
		switch (a) {
			case "--theme":
				args.theme = next() === "light" ? "xcsh-light" : "xcsh-dark";
				break;
			case "--color":
				args.color = next() as MermaidColorMode;
				break;
			case "--ascii":
				args.ascii = true;
				break;
			case "--type":
				args.type = next();
				break;
			case "--filter":
				args.filter = new RegExp(next(), "i");
				break;
			case "--list":
				args.list = true;
				break;
			case "--help":
			case "-h":
				console.log(
					"bun scripts/mermaid-gallery.ts [--theme dark|light] [--color none|ansi256|truecolor] [--ascii] [--type <t>] [--filter <regex>] [--list]",
				);
				process.exit(0);
		}
	}
	return args;
}

function selectSamples(args: Args): XcMermaidSample[] {
	return XC_MERMAID_SAMPLES.filter(s => {
		if (args.type && s.type !== args.type) return false;
		if (args.filter && !args.filter.test(`${s.id} ${s.category} ${s.prompt}`)) return false;
		return true;
	});
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const theme = await getThemeByName(args.theme);
	if (!theme) {
		console.error(`Unknown theme: ${args.theme}`);
		process.exit(1);
	}
	const samples = selectSamples(args);
	const width = Math.min(process.stdout.columns ?? 100, 110);
	const rule = (ch: string) => theme.fg("accent", ch.repeat(width));

	console.log(`\n${rule("━")}`);
	console.log(
		theme.fg("mdHeading", "  F5 XC Mermaid Gallery") +
			theme.fg(
				"muted",
				`   theme=${args.theme}  color=${args.color}  ascii=${args.ascii}  samples=${samples.length}`,
			),
	);
	console.log(rule("━"));

	if (args.list) {
		for (const [i, s] of samples.entries()) {
			console.log(
				`  ${theme.fg("dim", String(i + 1).padStart(2, "0"))}  ` +
					`${theme.fg("accent", s.type.padEnd(10))} ${theme.fg("mdHeading", s.id.padEnd(28))} ${theme.fg("muted", s.category)}`,
			);
		}
		console.log("");
		return;
	}

	for (const [i, s] of samples.entries()) {
		console.log(
			`\n${theme.fg("accent", "━━━")} ${theme.fg("dim", `[${i + 1}/${samples.length}]`)} ${theme.fg("mdHeading", s.category)} ${theme.fg("muted", "·")} ${theme.fg("success", s.type)} ${theme.fg("accent", "━".repeat(Math.max(0, width - s.category.length - s.type.length - 18)))}`,
		);
		console.log(`  ${theme.fg("dim", "▸")} ${theme.fg("mdLink", s.id)}`);
		console.log(`  ${theme.fg("muted", `"${s.prompt}"`)}\n`);

		const out = renderMermaidThemed(s.source, theme, { colorMode: args.color, render: { useAscii: args.ascii } });
		if (out == null) {
			console.log(`  ${theme.fg("error", "⚠ failed to render")}\n`);
			continue;
		}
		for (const line of out.split("\n")) console.log(`  ${line}`);
	}

	console.log(`\n${rule("━")}`);
	console.log(
		theme.fg("muted", `  Rendered ${samples.length} sample(s). Inspect the colors above and note anything to tune `) +
			theme.fg("dim", "(borders, labels, edges, arrows, per-node tints, contrast)."),
	);
	console.log(`${rule("━")}\n`);
}

await main();
