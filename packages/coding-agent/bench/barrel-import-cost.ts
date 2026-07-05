/**
 * Barrel-import cost benchmark for #1868.
 *
 * Measures `await import("@f5-sales-demo/xcsh")` — the full app barrel that the
 * extension / custom-tool / custom-command / hook loaders import to build the
 * `pi` API object. #1868 asks whether decoupling the loaders from that barrel is
 * worth a refactor; this benchmark supplies the number.
 *
 * Run manually:  bun packages/coding-agent/bench/barrel-import-cost.ts
 *
 * Two regimes that differ by orders of magnitude — report both:
 *
 *  - DEV (source transpile): a fresh `bun` process imports the barrel cold.
 *    This is the cost paid in `bun test` isolation — the figure #1867's
 *    `beforeAll` warm-up in extensions-runner.test.ts hides.
 *
 *  - COMPILED (bundled binary): by the time any loader runs, cli.ts → main.ts
 *    has already evaluated most of the barrel's re-exported module graph, so the
 *    loader's `import()` is a near cache-hit. In-context it measures BELOW the
 *    logger's 5ms span threshold (LOGGED_TIMING_THRESHOLD_MS), so `ext:barrelImport`
 *    never appears in PI_TIMING output. That sub-5ms cost is the UPPER BOUND on
 *    what the #1868 decouple could save from compiled startup.
 *
 * import() caches per-process, so every sample is a FRESH process.
 */
import * as path from "node:path";

const PKG_DIR = path.resolve(import.meta.dir, "..");
const COMPILED = path.join(PKG_DIR, "dist", "xcsh");
const N = 7;

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// DEV: fresh `bun -e` process times a single cold barrel import and prints ms.
const DEV_PROBE = `const t=Bun.nanoseconds();await import("@f5-sales-demo/xcsh");console.log(((Bun.nanoseconds()-t)/1e6).toFixed(2));`;

function devColdImportMs(): number {
	const proc = Bun.spawnSync([process.execPath, "-e", DEV_PROBE], { cwd: PKG_DIR, stderr: "ignore" });
	const out = proc.stdout.toString().trim().split("\n").pop() ?? "";
	const ms = Number.parseFloat(out);
	if (!Number.isFinite(ms)) throw new Error(`dev probe returned no number: ${JSON.stringify(out)}`);
	return ms;
}

const devSamples = Array.from({ length: N }, devColdImportMs);
console.log(`dev cold barrel import (fresh process, N=${N}):`);
console.log(`  samples: ${devSamples.map((x) => x.toFixed(0)).join(", ")}ms`);
console.log(`  median:  ${median(devSamples).toFixed(1)}ms  (first run is coldest — transpile cache)`);

// COMPILED: run the binary under PI_TIMING=x; the barrel import is sub-threshold
// (<5ms), so we assert its absence and report the containing ext:loadLoop span
// as the ceiling that already refutes any hundreds-of-ms barrel claim.
if (await Bun.file(COMPILED).exists()) {
	const proc = Bun.spawnSync([COMPILED], {
		env: { ...process.env, PI_TIMING: "x" },
		stdin: "ignore",
		stderr: "pipe",
		stdout: "ignore",
	});
	const timings = proc.stderr.toString();
	const barrel = timings.match(/ext:barrelImport:\s*([\d.]+)ms/);
	const loadLoop = timings.match(/ext:loadLoop:\s*([\d.]+)ms/);
	console.log(`\ncompiled in-context (${path.relative(PKG_DIR, COMPILED)}, PI_TIMING=x):`);
	if (barrel) {
		console.log(`  ext:barrelImport: ${barrel[1]}ms (exceeded 5ms threshold — investigate)`);
	} else {
		console.log(`  ext:barrelImport: <5ms (sub-threshold — not emitted; near cache-hit)`);
	}
	console.log(`  ext:loadLoop:     ${loadLoop ? `${loadLoop[1]}ms` : "n/a"} (contains barrelImport → hard ceiling)`);
} else {
	console.log(`\ncompiled: skipped — ${path.relative(PKG_DIR, COMPILED)} not found (run \`bun run build\`)`);
}
