#!/usr/bin/env bun
/**
 * Bundle guard: ensure the CLI entrypoint still bundles.
 *
 * Reproduces the `bun build --compile` module-graph analysis in ~1s so a
 * `require()` into a top-level-await subgraph (or other bundle-breaking graph
 * change) fails fast in a required CI gate — not only in the slower, optional
 * install-methods build. See PRs #1888 → #1892 for the regression this guards.
 *
 * Runs as a standalone `bun` process (not under `bun test`, whose bundler
 * resolver cannot resolve some lazily-imported specifiers). Exits non-zero on
 * any bundle error.
 */
import * as path from "node:path";

const cliEntry = path.resolve(import.meta.dir, "../src/cli.ts");

const result = await Bun.build({
	entrypoints: [cliEntry],
	target: "bun",
	define: { PI_COMPILED: "true" },
	external: ["mupdf"],
	throw: false,
});

if (!result.success) {
	console.error("Bundle check FAILED — the CLI entrypoint does not bundle:\n");
	for (const log of result.logs) console.error(String(log));
	process.exit(1);
}

console.log("Bundle check passed — CLI entrypoint bundles cleanly.");
