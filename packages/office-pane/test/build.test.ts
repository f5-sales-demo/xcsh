/**
 * Build smoke + browser-safety gate.
 *
 * Spawns the REAL build (a fresh `bun run build.ts` process — the same path a
 * later phase / CI uses) and asserts:
 *  - dist/taskpane.{js,html} are produced;
 *  - taskpane.html references the emitted bundle;
 *  - the emitted bundle imports NO `node:` builtins — the src/ boundary is
 *    browser-safe, so a node-coupled import (e.g. from the native xcsh contract)
 *    can never silently leak into the WebView. This is the load-bearing evidence
 *    for the "delete the mirror, import the native contract" rewire.
 *
 * A subprocess is used (rather than importing `build()` directly) because the
 * in-process `Bun.build` under `bun test` resolves some dual CJS/ESM deps (Fluent's
 * tabster) to their CJS entry; a real `bun` process resolves the ESM entry, which
 * is the shipping path we must verify.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PKG = dirname(import.meta.dir); // test/ → package root
const DIST = join(PKG, "dist");

describe("build.ts", () => {
	test("produces dist/taskpane.{html,js}; html references the bundle; bundle imports no node: builtins", () => {
		const result = spawnSync("bun", ["run", "build.ts"], { cwd: PKG, encoding: "utf8" });
		if (result.status !== 0) {
			throw new Error(`build.ts failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
		}

		expect(existsSync(join(DIST, "taskpane.html"))).toBe(true);
		expect(existsSync(join(DIST, "taskpane.js"))).toBe(true);

		const html = readFileSync(join(DIST, "taskpane.html"), "utf8");
		expect(html).toContain("taskpane.js");

		// Browser bundle must not import node:* builtins (src/ is browser-safe).
		// build.ts already asserts this and exits non-zero otherwise; re-assert here.
		const js = readFileSync(join(DIST, "taskpane.js"), "utf8");
		expect(js).not.toMatch(/["']node:[a-z][a-z0-9/._-]*["']/i);
	});
});
