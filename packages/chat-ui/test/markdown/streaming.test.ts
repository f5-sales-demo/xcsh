/**
 * LAYER 3 — streaming (jsdom, spec-faithful DOM; see register-jsdom.ts).
 *
 * Covers the pure `softCloseForStreaming` transform (unit) and the prefix / negative-pipe /
 * convergence / perf-budget behaviours the design requires: a streamed message
 * never flashes raw markup, a prose line with pipes never becomes a table, and a
 * completed document is a fixed point.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderMarkdown } from "../../src/markdown/render";
import { softCloseForStreaming } from "../../src/markdown/streaming";

const FIXTURES = path.resolve(import.meta.dir, "fixtures");
const readFixture = (n: string) => fs.readFileSync(path.join(FIXTURES, `${n}.md`), "utf8");

describe("softCloseForStreaming — fence closing", () => {
	test("an odd (open) fence count gets a synthetic closing fence", () => {
		expect(softCloseForStreaming("```ts\nconst x = 1")).toBe("```ts\nconst x = 1\n```");
	});
	test("a balanced fence pair is left untouched", () => {
		const md = "```ts\nconst x = 1\n```";
		expect(softCloseForStreaming(md)).toBe(md);
	});
});

describe("softCloseForStreaming — strict table hold", () => {
	test("holds a header + INCOMPLETE delimiter row (mismatched columns)", () => {
		expect(softCloseForStreaming("intro\n\n| a | b |\n|--")).toBe("intro\n");
	});
	test("holds a header + dash-started (in-progress) delimiter", () => {
		expect(softCloseForStreaming("| a | b |\n|-")).toBe("");
	});
	test("does NOT hold a bare pipe with no dash yet (still ambiguous with prose)", () => {
		const md = "| a | b |\n|";
		expect(softCloseForStreaming(md)).toBe(md);
	});
	test("does NOT hold a COMPLETE delimiter row (it is a real table)", () => {
		const md = "| a | b |\n| --- | --- |";
		expect(softCloseForStreaming(md)).toBe(md);
	});
	test("NEVER holds a lone prose line containing pipes", () => {
		const md = "use flag A | B to enable";
		expect(softCloseForStreaming(md)).toBe(md);
	});
	test("NEVER holds two prose lines that merely contain pipes", () => {
		const md = "col A | col B\nval C | val D";
		expect(softCloseForStreaming(md)).toBe(md);
	});
});

describe("Layer 3 — negative pipe: prose never becomes a table", () => {
	test("a prose line with pipes at EOF does not render a <table>", () => {
		const el = document.createElement("div");
		el.innerHTML = renderMarkdown("Use flag A | B to toggle it.");
		expect(el.querySelector("table")).toBeNull();
		expect(el.textContent).toContain("Use flag A | B to toggle it.");
	});
});

describe("Layer 3 — prefix rendering never leaks raw markup", () => {
	const fixtures = ["code-lang", "table", "table-aligned", "list-nested", "emphasis", "mixed-datasheet"];

	for (const name of fixtures) {
		test(`every prefix of ${name} renders without a raw fence/delimiter leak`, () => {
			const full = readFixture(name);
			const el = document.createElement("div");
			// Sample prefixes with a stride (bounded ~200 renders) instead of every
			// single character: each render is a full marked+DOMPurify parse, so an
			// O(n) per-char sweep over a rich fixture is O(n²) and can exceed the
			// test timeout in CI. A fence/delimiter leak is never a one-char knife
			// edge — it persists for the WHOLE run of prefixes while the partial
			// token is open (at least a full line), so a small stride cannot hide
			// one. The final full-length prefix is always checked.
			const step = Math.max(1, Math.ceil(full.length / 200));
			const check = (n: number): void => {
				el.innerHTML = renderMarkdown(full.slice(0, n));
				const text = el.textContent ?? "";
				// A mid-stream code block is soft-closed → no triple-backtick fence leaks as text.
				expect(text.includes("```"), `prefix ${n} of ${name} leaked a fence`).toBe(false);
				// A partial table is held → no delimiter row leaks as prose text.
				expect(/\|\s*-{2,}/.test(text), `prefix ${n} of ${name} leaked a delimiter`).toBe(false);
			};
			for (let n = 1; n < full.length; n += step) check(n);
			check(full.length);
		}, 20_000);
	}
});

describe("Layer 3 — convergence", () => {
	test("the final streamed frame equals the non-streamed render (fixed point)", () => {
		for (const name of fs.readdirSync(FIXTURES).filter(f => f.endsWith(".md"))) {
			const full = readFixture(name.slice(0, -3));
			// A complete document is a soft-close fixed point → identical HTML.
			expect(softCloseForStreaming(full)).toBe(full);
			expect(renderMarkdown(full.slice(0, full.length))).toBe(renderMarkdown(full));
		}
	});
});

describe("Layer 3 — perf budget (no O(n^2) parse)", () => {
	// Guards against a pathological (quadratic) table parse. Asserts SCALING, not an
	// absolute wall-clock budget: an absolute ms threshold is inherently flaky on shared
	// CI runners (it failed at 265ms vs a 250ms cap under load). A ratio cancels out the
	// runner's absolute speed and directly tests the O(n) intent.
	test("table parsing scales ~linearly with row count, not quadratically", () => {
		const buildTable = (rows: number) => {
			let md = "| col a | col b | col c |\n| --- | --- | --- |\n";
			for (let i = 0; i < rows; i++) md += `| r${i}a | r${i}b | r${i}c |\n`;
			return md;
		};
		const measure = (md: string) => {
			const start = performance.now();
			const html = renderMarkdown(md);
			return { ms: performance.now() - start, html };
		};
		// Warm up so first-call JIT compilation doesn't skew the small measurement.
		renderMarkdown(buildTable(50));
		const small = measure(buildTable(200));
		const large = measure(buildTable(1600)); // 8x the rows
		expect(large.html).toContain("<table>");
		// Linear parsing ⇒ ~8x the time; a quadratic blowup ⇒ ~64x. A 24x ceiling (3x the
		// linear factor) catches quadratic cost while tolerating runner noise + constant
		// factors. Floor the small measurement so sub-ms jitter can't inflate the ratio.
		const ratio = large.ms / Math.max(small.ms, 0.5);
		expect(ratio).toBeLessThan(24);
	});
});
