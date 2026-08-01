/**
 * LAYER 1 — rendering fidelity (jsdom, spec-faithful DOM; see register-jsdom.ts).
 *
 * For every fixture: (a) STRUCTURAL invariants via querySelector prove
 * Claude-level feature parity and kill the raw-pipe / info-string-leak
 * regressions; (b) normalized `renderMarkdown(md) === golden` guards the exact
 * HTML against drift (regenerate with `bun scripts/gen-md-goldens.ts`).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderMarkdown } from "../../src/markdown/render";
import { normalizeHtml } from "./normalize";

const FIXTURES = path.resolve(import.meta.dir, "fixtures");
const PKG_DIR = path.resolve(import.meta.dir, "..", "..");

function readFixture(name: string): string {
	return fs.readFileSync(path.join(FIXTURES, `${name}.md`), "utf8");
}

/** Parse rendered HTML into a detached container for structural querying. */
function renderInto(md: string): HTMLElement {
	const el = document.createElement("div");
	el.innerHTML = renderMarkdown(md);
	return el;
}

describe("Layer 1 — golden HTML equality", () => {
	const names = fs
		.readdirSync(FIXTURES)
		.filter(f => f.endsWith(".md"))
		.map(f => f.slice(0, -3))
		.sort();

	for (const name of names) {
		test(`${name} renders to its committed golden`, () => {
			const goldenPath = path.join(FIXTURES, `${name}.golden.html`);
			const golden = fs.readFileSync(goldenPath, "utf8");
			expect(normalizeHtml(renderMarkdown(readFixture(name)))).toBe(golden);
		});
	}
});

describe("Layer 1 — golden drift guard", () => {
	test("committed goldens are in sync with the renderer (gen --check exits 0)", () => {
		const r = spawnSync("bun", ["scripts/gen-md-goldens.ts", "--check"], { cwd: PKG_DIR, encoding: "utf8" });
		expect(r.stderr + r.stdout).toContain("up to date");
		expect(r.status).toBe(0);
	}, 15_000);
});

describe("Layer 1 — structural invariants", () => {
	test("headings emit h1..h6", () => {
		const el = renderInto(readFixture("headings"));
		for (let d = 1; d <= 6; d++) {
			expect(el.querySelector(`h${d}`)?.textContent).toBe(`Heading ${d}`);
		}
	});

	test("table has a thead with the header cells and a tbody", () => {
		const el = renderInto(readFixture("table"));
		expect(el.querySelector("table")).not.toBeNull();
		expect(el.querySelectorAll("thead th").length).toBe(2);
		expect(el.querySelectorAll("tbody tr").length).toBe(2);
	});

	test("aligned table emits enumerated md-align-* classes, never inline style", () => {
		const html = renderMarkdown(readFixture("table-aligned"));
		expect(html).not.toContain("style=");
		expect(html).not.toContain(" align=");
		const el = renderInto(readFixture("table-aligned"));
		expect(el.querySelector("th.md-align-left")?.textContent).toBe("Left");
		expect(el.querySelector("th.md-align-center")?.textContent).toBe("Center");
		expect(el.querySelector("th.md-align-right")?.textContent).toBe("Right");
		expect(el.querySelector("td.md-align-center")?.textContent).toBe("b");
	});

	test("unordered / ordered lists render li items", () => {
		expect(renderInto(readFixture("list-unordered")).querySelectorAll("ul > li").length).toBe(3);
		expect(renderInto(readFixture("list-ordered")).querySelectorAll("ol > li").length).toBe(3);
	});

	test("nested list nests a ul inside an li", () => {
		const el = renderInto(readFixture("list-nested"));
		expect(el.querySelector("ul > li > ul > li")).not.toBeNull();
		// depth 3 (parent → child → grandchild)
		expect(el.querySelector("ul > li > ul > li > ul > li")?.textContent).toBe("grandchild");
	});

	test("task list emits disabled checkbox inputs, checked reflecting [x]", () => {
		const el = renderInto(readFixture("task-list"));
		const boxes = el.querySelectorAll('li input[type="checkbox"]');
		expect(boxes.length).toBe(2);
		for (const b of boxes) expect((b as HTMLInputElement).disabled).toBe(true);
		expect((boxes[0] as HTMLInputElement).checked).toBe(false);
		expect((boxes[1] as HTMLInputElement).checked).toBe(true);
	});

	test("fenced code emits code.language-ts with NO info-string leak in the body", () => {
		const el = renderInto(readFixture("code-lang"));
		const code = el.querySelector("pre code.language-ts");
		expect(code).not.toBeNull();
		// The body is exactly the code — the `ts` info string must not appear in it.
		expect(code?.textContent?.trim()).toBe("const x: number = 1;");
		expect(el.querySelector(".md-lang-label")?.textContent).toBe("ts");
	});

	test("inline code renders code spans incl. a double-backtick span with a literal backtick", () => {
		const el = renderInto(readFixture("inline-code"));
		const spans = el.querySelectorAll("code");
		expect(spans.length).toBe(2);
		expect(spans[0].textContent).toBe("inline code");
		expect(spans[1].textContent).toBe("span with ` backtick");
	});

	test("blockquote renders", () => {
		expect(renderInto(readFixture("blockquote")).querySelector("blockquote")).not.toBeNull();
	});

	test("thematic break renders an hr", () => {
		expect(renderInto(readFixture("hr")).querySelector("hr")).not.toBeNull();
	});

	test("autolink: bare URL and email become safe new-tab links", () => {
		const el = renderInto(readFixture("autolink"));
		const links = el.querySelectorAll("a");
		expect(links.length).toBe(2);
		expect(links[0].getAttribute("href")).toBe("https://www.f5.com");
		expect(links[0].getAttribute("target")).toBe("_blank");
		expect(links[0].getAttribute("rel")).toContain("noopener");
		expect(links[1].getAttribute("href")).toBe("mailto:yuri@example.net");
	});

	test("emphasis: bold / italic / bold-italic / underscore variants", () => {
		const el = renderInto(readFixture("emphasis"));
		// strong: **bold**, __double__, and the strong inside ***bold-italic***.
		expect(el.querySelectorAll("strong").length).toBe(3);
		// em: *italic*, _underscored_, and the em wrapping ***bold-italic***.
		expect(el.querySelectorAll("em").length).toBe(3);
		expect(el.querySelector("em > strong")?.textContent).toBe("bold-italic");
	});

	test("strikethrough emits del", () => {
		expect(renderInto(readFixture("strikethrough")).querySelector("del")?.textContent).toBe("struck");
	});

	test("mixed datasheet carries every construct together", () => {
		const el = renderInto(readFixture("mixed-datasheet"));
		expect(el.querySelector("h1")).not.toBeNull();
		expect(el.querySelector("table th.md-align-right")).not.toBeNull();
		expect(el.querySelector("ul > li > ul > li")).not.toBeNull();
		expect(el.querySelector('input[type="checkbox"][disabled]')).not.toBeNull();
		expect(el.querySelector("pre code.language-yaml")).not.toBeNull();
		expect(el.querySelector("blockquote")).not.toBeNull();
		expect(el.querySelector("hr")).not.toBeNull();
		expect(el.querySelector("del")).not.toBeNull();
		expect(el.querySelector('a[href="https://www.f5.com"][target="_blank"]')).not.toBeNull();
	});
});
