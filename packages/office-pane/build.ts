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
import { gzipSync } from "node:zlib";

const HERE = path.dirname(Bun.fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "src");
const DIST = path.join(HERE, "dist");
const MANIFEST_DIR = path.join(HERE, "manifest");
const ASSETS_DIR = path.join(HERE, "assets");
const PACKAGE_JSON = path.join(HERE, "package.json");

/**
 * The Node core builtins. A browser bundle that imports any of these — with or
 * without the `node:` prefix — has leaked a node-coupled dependency (the classic
 * trap: `isomorphic-dompurify` → jsdom → `stream`/`buffer`/`path`).
 */
const NODE_BUILTINS = [
	"assert",
	"async_hooks",
	"buffer",
	"child_process",
	"cluster",
	"console",
	"constants",
	"crypto",
	"dgram",
	"diagnostics_channel",
	"dns",
	"domain",
	"events",
	"fs",
	"http",
	"http2",
	"https",
	"inspector",
	"module",
	"net",
	"os",
	"path",
	"perf_hooks",
	"process",
	"punycode",
	"querystring",
	"readline",
	"repl",
	"stream",
	"string_decoder",
	"sys",
	"timers",
	"tls",
	"trace_events",
	"tty",
	"url",
	"util",
	"v8",
	"vm",
	"wasi",
	"worker_threads",
	"zlib",
];

/** Max gzipped size of the emitted `taskpane.js`. Catches a runaway dep (e.g. a
 * node-coupled or oversized module) sneaking into the WebView bundle. */
export const GZIP_BUDGET_BYTES = 256 * 1024;

/**
 * Fail if the emitted bundle imports any Node builtin. `src/` is browser-safe by
 * contract; this is the deterministic gate that keeps it so. Two forms are caught:
 *  - a QUOTED `node:` specifier (`"node:fs"` / `import("node:fs")`) — not the bare
 *    substring "node:", which appears in minified object keys (`{node:x}`);
 *  - a BARE builtin specifier (`require('buffer')`, `from "path"`, `import("stream")`)
 *    — matched only in an import/require POSITION so a benign string or object key
 *    that merely equals a builtin name (`{ path: "x" }`) does not false-positive.
 */
export function assertNoNodeBuiltins(js: string, file: string): void {
	const prefixed = js.match(/["']node:[a-z][a-z0-9/._-]*["']/i);
	if (prefixed) {
		throw new Error(`Browser bundle ${file} imports a node: builtin (${prefixed[0]}) — src/ must stay browser-safe`);
	}
	const bare = js.match(
		new RegExp(`(?:\\brequire\\(|\\bfrom\\s+|\\bimport\\()\\s*["'](${NODE_BUILTINS.join("|")})["']`),
	);
	if (bare) {
		throw new Error(
			`Browser bundle ${file} imports a bare node builtin ("${bare[1]}") — src/ must stay browser-safe (a node-coupled dep leaked in)`,
		);
	}
}

/** Fail if the gzipped bundle exceeds {@link GZIP_BUDGET_BYTES}. */
export function assertGzBudget(js: string, file: string): void {
	const gz = gzipSync(Buffer.from(js)).length;
	if (gz > GZIP_BUDGET_BYTES) {
		throw new Error(
			`Browser bundle ${file} is ${(gz / 1024).toFixed(1)}KB gzipped, over the ${GZIP_BUDGET_BYTES / 1024}KB budget — investigate what was added (a node-coupled or oversized dep?)`,
		);
	}
	console.log(`  gzip: ${(gz / 1024).toFixed(1)}KB / ${GZIP_BUDGET_BYTES / 1024}KB budget`);
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
		// React (and much of the ecosystem) branches on this at runtime. Without
		// the substitution the DEVELOPMENT build is what gets bundled and served
		// through AppSource: prop-validation and warning machinery customers can
		// never act on, and a third of the gzipped payload. `build.test.ts`
		// asserts the emitted artifact really is the production build.
		define: { "process.env.NODE_ENV": JSON.stringify("production") },
	});

	if (!result.success) {
		for (const log of result.logs) {
			console.error(log);
		}
		throw new Error("Bun.build failed for src/taskpane.tsx");
	}

	const bundlePath = path.join(DIST, "taskpane.js");
	const bundleJs = await Bun.file(bundlePath).text();
	assertNoNodeBuiltins(bundleJs, "taskpane.js");
	assertGzBudget(bundleJs, "taskpane.js");

	// Copy the page shell, pinning the module script to the built bundle name.
	const packageVersion = ((await Bun.file(PACKAGE_JSON).json()) as { version: string }).version;
	const html = (await Bun.file(path.join(SRC, "taskpane.html")).text()).replace(
		/(<script\b[^>]*\bsrc=")[^"]*taskpane[^"]*("[^>]*><\/script>)/,
		`$1./taskpane.js?v=${packageVersion}$2`,
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
