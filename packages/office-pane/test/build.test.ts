/**
 * Build smoke + browser-safety gate.
 *
 * Spawns the REAL build (a fresh `bun run build.ts` process — the same path a
 * later phase / CI uses) and asserts:
 *  - dist/taskpane.{js,html} are produced;
 *  - taskpane.html references the emitted bundle;
 *  - the full served asset set (manifest.json + ribbon/app icons + the bundled
 *    MesloLGS NF fonts) is copied into dist/ so `generate-client-bundle.ts`
 *    embeds it and `xcsh office serve` can serve it — dist/ is the single source
 *    of truth for the embedded add-in;
 *  - the emitted bundle imports NO `node:` builtins — the src/ boundary is
 *    browser-safe, so a node-coupled import (e.g. from the native xcsh contract)
 *    can never silently leak into the WebView. This is the load-bearing evidence
 *    for the "delete the mirror, import the native contract" rewire.
 *
 * A subprocess is used (rather than importing `build()` directly) because a real
 * `bun` process resolves each dep's ESM entry — the shipping path we must verify —
 * rather than the CJS entry the in-process `Bun.build` under `bun test` can pick.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertGzBudget, assertNoNodeBuiltins, GZIP_BUDGET_BYTES } from "../build";

const PKG = dirname(import.meta.dir); // test/ → package root
const DIST = join(PKG, "dist");

describe("assertNoNodeBuiltins — browser-safety gate", () => {
	test("flags a quoted node: specifier", () => {
		expect(() => assertNoNodeBuiltins('import x from "node:fs";', "f.js")).toThrow(/node:/);
	});

	test("flags a BARE builtin specifier in import / require / dynamic-import position", () => {
		expect(() => assertNoNodeBuiltins('import { Buffer } from "buffer";', "f.js")).toThrow(/buffer/);
		expect(() => assertNoNodeBuiltins('const s = require("stream");', "f.js")).toThrow(/stream/);
		expect(() => assertNoNodeBuiltins('await import("path");', "f.js")).toThrow(/path/);
	});

	test("does NOT flag a benign object key or string that merely equals a builtin name", () => {
		expect(() => assertNoNodeBuiltins('const o = { path: "x", buffer: 1 }; const p = "path";', "f.js")).not.toThrow();
	});

	test("passes clean browser JS", () => {
		expect(() => assertNoNodeBuiltins('import React from "react"; export const x = 1;', "f.js")).not.toThrow();
	});
});

describe("assertGzBudget — bundle size budget", () => {
	test("throws with a clear message when the gzipped bundle exceeds the budget", () => {
		// Genuinely high-entropy (incompressible) content so the GZIPPED size exceeds
		// the budget — repeated bytes would compress to near-zero.
		const huge = randomBytes(GZIP_BUDGET_BYTES * 2).toString("base64");
		expect(() => assertGzBudget(huge, "taskpane.js")).toThrow(/budget/i);
	});

	test("passes a small bundle", () => {
		expect(() => assertGzBudget("export const x = 1;", "taskpane.js")).not.toThrow();
	});
});

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

		// The served asset set must land in dist/ (source of truth for the embed).
		expect(existsSync(join(DIST, "manifest.json"))).toBe(true);
		expect(existsSync(join(DIST, "assets", "icon-16.png"))).toBe(true);
		expect(existsSync(join(DIST, "assets", "icon-32.png"))).toBe(true);
		expect(existsSync(join(DIST, "assets", "icon-80.png"))).toBe(true);
		expect(existsSync(join(DIST, "assets", "color.png"))).toBe(true);
		expect(existsSync(join(DIST, "assets", "outline.png"))).toBe(true);

		// The bundled MesloLGS NF fonts must land in dist/fonts/ (relative to the
		// page), matching the shared injectFontFaces identity resolver's URLs.
		expect(existsSync(join(DIST, "fonts", "MesloLGS-NF-Regular.ttf"))).toBe(true);
		expect(existsSync(join(DIST, "fonts", "MesloLGS-NF-Bold.ttf"))).toBe(true);
		expect(existsSync(join(DIST, "fonts", "MesloLGS-NF-Italic.ttf"))).toBe(true);
		expect(existsSync(join(DIST, "fonts", "MesloLGS-NF-Bold-Italic.ttf"))).toBe(true);

		// The copied manifest must still parse and keep the local-ip.sh page URL.
		const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
		expect(manifest.extensions[0].runtimes[0].code.page).toBe("https://127-0-0-1.local-ip.sh:8444/taskpane.html");

		// Browser bundle must not import node:* builtins (src/ is browser-safe).
		// build.ts already asserts this and exits non-zero otherwise; re-assert here.
		const js = readFileSync(join(DIST, "taskpane.js"), "utf8");
		expect(js).not.toMatch(/["']node:[a-z][a-z0-9/._-]*["']/i);
	});

	// Guards the NODE_ENV define. Without it `process.env.NODE_ENV` is never
	// substituted, React keeps its development branch, and the AppSource-served
	// pane ships dev-only warning machinery -- a third of the gzipped bundle.
	// Asserted on the real artifact rather than on build.ts's source so the
	// guard survives a refactor of how the define is supplied.
	test("ships React's PRODUCTION build, not the development build", () => {
		const js = readFileSync(join(DIST, "taskpane.js"), "utf8");
		// Assert on booleans, not on `js` itself: a failed .toContain against a
		// ~500 KB minified bundle dumps the whole thing into the test output.
		const has = (needle: string) => js.includes(needle);

		// Dev-only machinery must be absent.
		for (const devMarker of [
			"_debugSource",
			"unstable_isNewReconciler",
			"Each child in a list should have a unique",
		]) {
			expect(has(devMarker), `dev-build marker "${devMarker}" present — is the NODE_ENV define missing?`).toBe(
				false,
			);
		}

		// And the production error path must be present. Checking only for the
		// absence of dev markers would also pass if React were dropped entirely,
		// so this is the positive half of the assertion.
		expect(has("Minified React error"), "production React error path absent — not a production build").toBe(true);

		// Nothing should still be branching on an unsubstituted NODE_ENV.
		expect(has("process.env.NODE_ENV"), "unsubstituted process.env.NODE_ENV remains in the bundle").toBe(false);
	});
});
