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
});
