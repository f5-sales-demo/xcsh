#!/usr/bin/env bun
/**
 * Regenerate the committed golden HTML for every markdown fixture:
 * `test/markdown/fixtures/<name>.md` → `test/markdown/fixtures/<name>.golden.html`.
 *
 * The goldens are the AUTOMATED rendering-fidelity oracle for the Layer-1 test.
 * They are produced through the REAL `renderMarkdown` pipeline (marked → DOMPurify)
 * against a SPEC-FAITHFUL jsdom DOM — matching what the Office WebView renders,
 * not happy-dom's non-faithful DOMPurify traversal — then normalized (see
 * normalize.ts). Regenerate + HUMAN-REVIEW the diff whenever the renderer changes.
 *
 * Usage:
 *   bun scripts/gen-md-goldens.ts            # (re)write every golden
 *   bun scripts/gen-md-goldens.ts --check    # exit 1 if any committed golden is stale (CI)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { JSDOM } from "jsdom";

// Register a jsdom window BEFORE importing the renderer, so its lazily-bound
// DOMPurify binds to a spec-faithful DOM.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://localhost/" });
const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;

const { renderMarkdown } = await import("../src/markdown/render");
const { normalizeHtml } = await import("../test/markdown/normalize");

const FIXTURES = path.resolve(import.meta.dir, "..", "test", "markdown", "fixtures");
const check = process.argv.includes("--check");

const names = fs
	.readdirSync(FIXTURES)
	.filter(f => f.endsWith(".md"))
	.map(f => f.slice(0, -3))
	.sort();

let stale = 0;
for (const name of names) {
	const md = fs.readFileSync(path.join(FIXTURES, `${name}.md`), "utf8");
	const golden = normalizeHtml(renderMarkdown(md));
	const goldenPath = path.join(FIXTURES, `${name}.golden.html`);
	const current = fs.existsSync(goldenPath) ? fs.readFileSync(goldenPath, "utf8") : null;
	if (current === golden) continue;
	stale++;
	if (check) {
		console.error(`stale golden: ${name}.golden.html`);
	} else {
		fs.writeFileSync(goldenPath, golden);
		console.log(`wrote ${name}.golden.html`);
	}
}

if (check) {
	if (stale > 0) {
		console.error(`${stale} golden(s) out of date — run: bun scripts/gen-md-goldens.ts`);
		process.exit(1);
	}
	console.log("goldens up to date");
} else {
	console.log(`Generated ${names.length} golden(s) → ${FIXTURES}/`);
}
