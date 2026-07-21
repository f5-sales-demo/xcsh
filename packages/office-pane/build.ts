/**
 * Task-pane browser build.
 *
 * Bundles `src/taskpane.tsx` (its React + shared `@f5-sales-demo/xcsh-chat-ui` +
 * local core/panel/office deps) into `dist/` for the browser, and copies the page
 * shell + the bundled MesloLGS NF fonts so a later phase can serve or embed a
 * self-contained add-in.
 *
 * Dev-only tooling: this file uses `node:*` / `Bun.build` and is NEVER part of
 * the shipped browser bundle — the browser-safe boundary stays in `src/`. The
 * build asserts the emitted bundle carries no `node:` builtins so a
 * node-coupled import can never silently leak into the WebView.
 *
 * Usage: `bun run build` (or `bun run build.ts`).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

const HERE = path.dirname(Bun.fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "src");
const DIST = path.join(HERE, "dist");
const MANIFEST_DIR = path.join(HERE, "manifest");
const ASSETS_DIR = path.join(HERE, "assets");

/**
 * Fail if the emitted bundle imports any `node:` builtin. `src/` is browser-safe
 * by contract; this is the deterministic gate that keeps it so. We match a
 * QUOTED module specifier (`"node:…"` / `'node:…'` / `import("node:…")`) rather
 * than the bare substring "node:", which also appears in minified object keys
 * (e.g. `{node:x}`) and would false-positive.
 */
function assertNoNodeBuiltins(js: string, file: string): void {
	const match = js.match(/["']node:[a-z][a-z0-9/._-]*["']/i);
	if (match) {
		throw new Error(`Browser bundle ${file} imports a node: builtin (${match[0]}) — src/ must stay browser-safe`);
	}
}

/**
 * Build the task-pane bundle into `dist/`:
 *  - `Bun.build` `src/taskpane.tsx` → `dist/taskpane.js` (`target:"browser"`,
 *    `format:"esm"`, minified);
 *  - assert the emitted JS carries no `node:` builtins;
 *  - copy `src/taskpane.html` → `dist/taskpane.html`, normalising the module
 *    `<script src>` to the emitted `./taskpane.js`;
 *  - copy the served add-in assets (`manifest/manifest.json` + `manifest/assets/*`)
 *    and the bundled fonts (`assets/fonts/*` → `dist/fonts/`) into `dist/`, so
 *    `dist/` is the single source of truth for the bundle that
 *    `generate-client-bundle.ts` embeds and `xcsh office serve` serves.
 */

/** Recursively copy every file under `srcDir` into `destDir` (preserving layout). */
async function copyDir(srcDir: string, destDir: string): Promise<void> {
	const entries = await fs.readdir(srcDir, { withFileTypes: true });
	await fs.mkdir(destDir, { recursive: true });
	for (const entry of entries) {
		const from = path.join(srcDir, entry.name);
		const to = path.join(destDir, entry.name);
		if (entry.isDirectory()) {
			await copyDir(from, to);
		} else if (entry.isFile()) {
			await fs.copyFile(from, to);
		}
	}
}

export async function build(): Promise<void> {
	await fs.rm(DIST, { recursive: true, force: true });
	await fs.mkdir(DIST, { recursive: true });

	const result = await Bun.build({
		entrypoints: [path.join(SRC, "taskpane.tsx")],
		outdir: DIST,
		target: "browser",
		format: "esm",
		minify: true,
		sourcemap: "none",
		naming: "[dir]/[name].[ext]",
	});

	if (!result.success) {
		for (const log of result.logs) {
			console.error(log);
		}
		throw new Error("Bun.build failed for src/taskpane.tsx");
	}

	const bundlePath = path.join(DIST, "taskpane.js");
	assertNoNodeBuiltins(await Bun.file(bundlePath).text(), "taskpane.js");

	// Copy the page shell, pinning the module script to the built bundle name.
	const html = (await Bun.file(path.join(SRC, "taskpane.html")).text()).replace(
		/(<script\b[^>]*\bsrc=")[^"]*taskpane[^"]*("[^>]*><\/script>)/,
		"$1./taskpane.js$2",
	);
	await Bun.write(path.join(DIST, "taskpane.html"), html);

	// Ship the manifest + ribbon/app icons so the served set is self-contained.
	await Bun.write(path.join(DIST, "manifest.json"), await Bun.file(path.join(MANIFEST_DIR, "manifest.json")).text());
	await copyDir(path.join(MANIFEST_DIR, "assets"), path.join(DIST, "assets"));

	// Ship the bundled MesloLGS NF fonts → dist/fonts/, matching the relative
	// `fonts/*.ttf` URLs the shared `injectFontFaces` identity resolver emits.
	await copyDir(path.join(ASSETS_DIR, "fonts"), path.join(DIST, "fonts"));

	console.log(`Build complete → ${DIST}/`);
	console.log(
		`  Outputs: ${result.outputs.map(o => o.path).join(", ")}, ${path.join(DIST, "taskpane.html")}, ${path.join(DIST, "manifest.json")}, ${path.join(DIST, "assets")}/, ${path.join(DIST, "fonts")}/`,
	);
}

if (import.meta.main) {
	await build();
}
