import { describe, expect, it } from "bun:test";
import * as path from "node:path";

/**
 * Regression guards for the module-graph failure modes that shipped a broken
 * `main` (PRs #1888 → #1892):
 *
 *  - A lazy `require("./read")` in renderers.ts pulled `chunk.ts → lru-cache`,
 *    which has a top-level await. A sync `require()` cannot pull a TLA subgraph,
 *    so `bun build --compile` failed — but only in the (non-required)
 *    install-methods job, so it auto-merged. The bundle guard reproduces that
 *    analysis in a required gate.
 *
 *  - An import cycle back into renderers.ts caused a `grepToolRenderer` TDZ when
 *    a tool module was imported first. Importing the leaf modules standalone and
 *    asserting their exports resolve catches that class at runtime.
 */

const PKG_ROOT = path.resolve(import.meta.dir, "../..");
const SRC = path.join(PKG_ROOT, "src");

describe("CLI entrypoint bundles (guards require-of-top-level-await)", () => {
	// Runs the real Bun.build via scripts/check-bundle.ts in a fresh `bun`
	// process — `bun test`'s bundler resolver can't resolve some lazily-imported
	// specifiers, so an inline Bun.build here would be a false negative.
	it("scripts/check-bundle.ts exits 0", () => {
		const proc = Bun.spawnSync(["bun", "scripts/check-bundle.ts"], { cwd: PKG_ROOT, stderr: "pipe", stdout: "pipe" });
		if (proc.exitCode !== 0) {
			// Surface the bundler diagnostics (e.g. the require-of-TLA error).
			throw new Error(`check-bundle failed:\n${proc.stderr.toString()}\n${proc.stdout.toString()}`);
		}
		expect(proc.exitCode).toBe(0);
	}, 60_000);
});

describe("tool modules import standalone without a TDZ (guards import cycles)", () => {
	// Importing these leaf-first is what previously tripped the renderers.ts <-
	// read.ts / grep.ts cycles; a TDZ would throw on import.
	it("grep.ts exports resolve", async () => {
		const mod = await import(path.join(SRC, "tools/grep.ts"));
		expect(typeof mod.GrepTool).toBe("function");
		expect(mod.grepToolRenderer).toBeDefined();
	});

	it("read.ts exports resolve", async () => {
		const mod = await import(path.join(SRC, "tools/read.ts"));
		expect(mod.readToolRenderer).toBeDefined();
	});

	it("renderers.ts registry resolves the read + grep renderers", async () => {
		const mod = await import(path.join(SRC, "tools/renderers.ts"));
		expect(mod.toolRenderers).toBeDefined();
		expect(mod.toolRenderers.read).toBeDefined();
		expect(mod.toolRenderers.grep).toBeDefined();
	});
});
