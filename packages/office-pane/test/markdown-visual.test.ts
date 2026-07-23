/**
 * LAYER 4 — visual / computed-style eval (Puppeteer, real Chromium).
 *
 * This layer needs a real browser, so it is GATED behind `XCSH_VISUAL=1` and
 * skipped in the default `bun run test`. The PARENT runs it on a Chrome-equipped
 * runner:  `XCSH_VISUAL=1 bun test ./test/markdown-visual.test.ts`.
 *
 * What it proves (the HARD gate): the REAL rendered markdown (the committed,
 * spec-faithful `mixed-datasheet.golden.html`) under the REAL shared stylesheet
 * (`cssVars()` + `PANEL_CSS`) with `.xcsh-doc` set actually COMPUTES to the
 * document look — proportional-sans prose at ≥14px with relaxed leading, a
 * constrained measure, bordered header cells, a monospaced code block, and a
 * descending heading scale — at 320 / 480 / 640px pane widths. PNGs are captured
 * per width as an advisory contact sheet (pixel diff is out of scope: no
 * committed baseline; the computed-style assertions are the automated oracle).
 *
 * Deviation (documented): rather than boot the full `dist/taskpane.js` (which
 * needs the Office.js runtime + a live bridge), it injects the SAME shipped HTML
 * (`renderMarkdown`'s committed output) + the SAME shipped CSS the bundle uses,
 * so the computed styles are identical to production without an Office host.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cssVars, PANEL_CSS } from "@f5-sales-demo/xcsh-chat-ui";
import type { Browser } from "puppeteer";

const RUN = process.env.XCSH_VISUAL === "1";
const PKG = dirname(import.meta.dir);
const GOLDEN = resolve(PKG, "..", "chat-ui", "test", "markdown", "fixtures", "mixed-datasheet.golden.html");
const OUT_DIR = join(PKG, "test", "__visual__");
const WIDTHS = [320, 480, 640] as const;

/** The shipped page: shared tokens + panel stylesheet + the real rendered doc. */
function harnessHtml(bodyHtml: string): string {
	return `<!doctype html><html><head><meta charset="utf-8">
<style>${cssVars()}</style>
<style>${PANEL_CSS}</style>
</head><body>
<div class="xcsh-panel xcsh-doc"><div class="messages"><div class="row"><div class="content">
<div class="body markdown-root" id="md">${bodyHtml}</div>
</div></div></div></div>
</body></html>`;
}

describe.skipIf(!RUN)("Layer 4 — computed-style document parity", () => {
	test("mixed datasheet computes to the sans document look at 3 pane widths", async () => {
		const golden = readFileSync(GOLDEN, "utf8");
		mkdirSync(OUT_DIR, { recursive: true });

		const puppeteer = (await import("puppeteer")).default;
		const browser: Browser = await puppeteer.launch({
			headless: true,
			args: ["--no-sandbox", "--force-device-scale-factor=1"],
		});
		try {
			for (const width of WIDTHS) {
				const page = await browser.newPage();
				await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
				await page.setContent(harnessHtml(golden), { waitUntil: "load" });

				const probe = await page.evaluate(() => {
					const px = (v: string) => Number.parseFloat(v);
					const body = document.querySelector(".markdown-root") as HTMLElement;
					const p = document.querySelector(".markdown-root p") as HTMLElement;
					const code = document.querySelector(".markdown-root pre code") as HTMLElement;
					const th = document.querySelector(".markdown-root th") as HTMLElement;
					const h1 = document.querySelector(".markdown-root h1") as HTMLElement;
					const h2 = document.querySelector(".markdown-root h2") as HTMLElement;
					const h3 = document.querySelector(".markdown-root h3") as HTMLElement;
					const bs = getComputedStyle(body);
					const ps = getComputedStyle(p);
					const cs = getComputedStyle(code);
					const ts = getComputedStyle(th);
					return {
						fontFamily: bs.fontFamily,
						fontSize: px(bs.fontSize),
						lineHeightRatio: px(ps.lineHeight) / px(ps.fontSize),
						pMarginTop: px(ps.marginTop),
						maxWidth: px(bs.maxWidth),
						codeFontFamily: cs.fontFamily,
						thBorderTop: ts.borderTopWidth,
						thBg: ts.backgroundColor,
						h1: px(getComputedStyle(h1).fontSize),
						h2: px(getComputedStyle(h2).fontSize),
						h3: px(getComputedStyle(h3).fontSize),
					};
				});

				await page.screenshot({ path: join(OUT_DIR, `mixed-datasheet-${width}.png`) as `${string}.png` });
				await page.close();

				// Prose is the proportional SYSTEM sans, NOT the terminal mono.
				expect(probe.fontFamily.toLowerCase()).toContain("-apple-system");
				expect(probe.fontFamily).not.toContain("MesloLGS");
				expect(probe.fontSize).toBeGreaterThanOrEqual(14);
				// Relaxed leading (~1.62).
				expect(probe.lineHeightRatio).toBeGreaterThan(1.5);
				expect(probe.lineHeightRatio).toBeLessThan(1.75);
				// Paragraph rhythm + constrained measure.
				expect(probe.pMarginTop).toBeGreaterThan(0);
				expect(probe.maxWidth).toBeLessThanOrEqual(660);
				// Code stays monospaced.
				expect(probe.codeFontFamily).toContain("MesloLGS");
				// Header cell is bordered with a header background.
				expect(probe.thBorderTop).toBe("1px");
				expect(probe.thBg).not.toBe("rgba(0, 0, 0, 0)");
				// Descending heading scale.
				expect(probe.h1).toBeGreaterThan(probe.h2);
				expect(probe.h2).toBeGreaterThan(probe.h3);
			}
		} finally {
			await browser.close();
		}
	}, 60_000);
});
