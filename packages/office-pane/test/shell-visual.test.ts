/**
 * LAYER 4 — visual / computed-layout eval for the pane SHELL (Puppeteer, real Chromium).
 *
 * Sibling of `markdown-visual.test.ts` (which covers document typography); this one
 * covers the Claude-for-Office shell chrome that unit tests can't judge, because
 * jsdom/happy-dom have no layout engine: what is PINNED vs what SCROLLS, whether the
 * control row clears Office's own button, whether stacked pills really stack, and
 * whether the CSS tooltip actually becomes visible on hover.
 *
 * GATED behind `XCSH_VISUAL=1` and skipped in the default `bun run test`. Run it on a
 * Chrome-equipped runner:  `XCSH_VISUAL=1 bun test ./test/shell-visual.test.ts`.
 *
 * It server-renders the REAL shipped components (`HeaderBar`, `Transcript`,
 * `EmptyState`) composed exactly as `ChatPanel` composes them, into the REAL shared
 * stylesheet (`cssVars()` + `PANEL_CSS`) with the same root classes `mountGate` sets.
 * Deviation (same one markdown-visual documents): it does not boot
 * `dist/taskpane.js`, which would need the Office.js runtime and a live bridge — but
 * the markup and CSS are the shipped ones, so the computed layout is production's.
 *
 * SCOPE LIMIT, stated so these assertions aren't over-read: static markup runs no
 * effects, so this layer cannot exercise Transcript's auto-pin `useLayoutEffect`. It
 * verifies the LAYOUT consequences (what moves when the scrollport scrolls, what the
 * brand's resting position is). That the effect itself skips an empty transcript is
 * covered by `chat-ui/test/Transcript.test.tsx`, which renders on the client and
 * stubs `scrollHeight` so a stray pin is observable.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type ChatMessage,
	cssVars,
	EmptyState,
	F5Logo,
	HeaderBar,
	PANEL_CSS,
	Transcript,
} from "@f5-sales-demo/xcsh-chat-ui";
import type { Browser } from "puppeteer";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const RUN = process.env.XCSH_VISUAL === "1";
const PKG = dirname(import.meta.dir);
const OUT_DIR = join(PKG, "test", "__visual__");
/** Narrowest real task pane, and a roomier one. */
const WIDTHS = [320, 480] as const;
/** Office draws its own ⓘ over the pane's top-right; our row must not sit under it. */
const MIN_RIGHT_RESERVE = 28;

/** Enough turns to overflow the scrollport, so "does the brand scroll?" is decidable. */
function longConversation(): ChatMessage[] {
	const out: ChatMessage[] = [];
	for (let i = 0; i < 12; i++) {
		out.push({ id: `u${i}`, role: "user", text: `Question ${i} about the quarterly figures` });
		out.push({
			id: `a${i}`,
			role: "assistant",
			text: `Answer ${i}. ${"Sales rose across every region this quarter. ".repeat(3)}`,
		});
	}
	return out;
}

const SKILL_PILLS = [
	{ id: "competitive", label: "/competitive", hint: "F5 XC battlecards" },
	{ id: "roi-calculator", label: "/roi-calculator", hint: "ROI / TCO" },
	{ id: "waap-full-stack-demo", label: "/waap-full-stack-demo", hint: "Build a WAAP demo" },
];

/** The shipped shell: same root classes as `mountGate`, same components as ChatPanel. */
function harnessHtml(messages: ChatMessage[]): string {
	const brand = h(
		"div",
		{ className: "brand-block" },
		h(F5Logo, { variant: "mark", size: 20 }),
		h("span", { className: "brand-title" }, "xcsh"),
	);
	const shell = h(
		"div",
		{ className: "xcsh-panel xcsh-doc xcsh-host-office" },
		h(HeaderBar, {
			onNewChat: () => {},
			historyItems: [{ id: "conv-1", label: "An earlier chat" }],
			historyHeader: "This session",
			moreItems: [{ id: "settings", label: "Settings" }],
		}),
		h(Transcript, {
			messages,
			streaming: false,
			brand,
			emptyState: h(EmptyState, { pills: SKILL_PILLS, onPick: () => {}, stacked: true, logo: false }),
		}),
	);
	return `<!doctype html><html><head><meta charset="utf-8">
<style>${cssVars()}</style>
<style>${PANEL_CSS}</style>
<style>html,body{margin:0;height:100%} .xcsh-panel{height:100%}</style>
</head><body>${renderToStaticMarkup(shell)}</body></html>`;
}

describe.skipIf(!RUN)("Layer 4 — computed-layout shell parity", () => {
	test("the brand scrolls with the transcript while the control row stays pinned", async () => {
		mkdirSync(OUT_DIR, { recursive: true });
		const puppeteer = (await import("puppeteer")).default;
		const browser: Browser = await puppeteer.launch({
			headless: true,
			args: ["--no-sandbox", "--force-device-scale-factor=1"],
		});
		try {
			for (const width of WIDTHS) {
				const page = await browser.newPage();
				await page.setViewport({ width, height: 640, deviceScaleFactor: 1 });
				await page.setContent(harnessHtml(longConversation()), { waitUntil: "load" });

				const probe = await page.evaluate(() => {
					const messages = document.querySelector(".messages") as HTMLElement;
					const header = document.querySelector(".header") as HTMLElement;
					const brand = document.querySelector(".brand-block") as HTMLElement;
					const before = {
						header: header.getBoundingClientRect().top,
						brand: brand.getBoundingClientRect().top,
					};
					messages.scrollTop = 99_999;
					return {
						brandInScrollport: messages.contains(brand),
						headerInScrollport: messages.contains(header),
						overflows: messages.scrollHeight > messages.clientHeight,
						before,
						after: {
							header: header.getBoundingClientRect().top,
							brand: brand.getBoundingClientRect().top,
						},
						scrollportTop: messages.getBoundingClientRect().top,
					};
				});

				await page.screenshot({ path: join(OUT_DIR, `shell-scrolled-${width}.png`) as `${string}.png` });
				await page.close();

				// The premise of the test: there is something to scroll.
				expect(probe.overflows).toBe(true);
				// Structure: brand inside the scrollport, control row outside it.
				expect(probe.brandInScrollport).toBe(true);
				expect(probe.headerInScrollport).toBe(false);
				// The control row does not move…
				expect(probe.after.header).toBeCloseTo(probe.before.header, 0);
				// …while the brand scrolls up and out of the scrollport entirely.
				expect(probe.after.brand).toBeLessThan(probe.before.brand - 50);
				expect(probe.after.brand).toBeLessThan(probe.scrollportTop);
			}
		} finally {
			await browser.close();
		}
	}, 60_000);

	test("on an empty pane the brand is visible above the starters, not scrolled past", async () => {
		const puppeteer = (await import("puppeteer")).default;
		const browser: Browser = await puppeteer.launch({
			headless: true,
			args: ["--no-sandbox", "--force-device-scale-factor=1"],
		});
		try {
			const page = await browser.newPage();
			await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 1 });
			await page.setContent(harnessHtml([]), { waitUntil: "load" });

			const probe = await page.evaluate(() => {
				const messages = document.querySelector(".messages") as HTMLElement;
				const brand = messages.querySelector(".brand-block") as HTMLElement;
				const mark = brand.querySelector(".f5-mark") as HTMLElement;
				const markRect = mark.getBoundingClientRect();
				const pills = Array.from(messages.querySelectorAll<HTMLElement>(".pill")).map(p => {
					const r = p.getBoundingClientRect();
					return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) };
				});
				const b = brand.getBoundingClientRect();
				const m = messages.getBoundingClientRect();
				return {
					scrollTop: messages.scrollTop,
					brandTop: b.top,
					brandHeight: Math.round(b.height),
					markSize: { w: Math.round(markRect.width), h: Math.round(markRect.height) },
					brandVisible: b.top >= m.top && b.bottom <= m.bottom,
					firstPillTop: pills[0]?.top ?? 0,
					pills,
					pillsStacked: (messages.querySelector(".pills") as HTMLElement).classList.contains("pills-stacked"),
				};
			});

			await page.screenshot({ path: join(OUT_DIR, "shell-empty-320.png") });
			await page.close();

			// At rest (scrollTop 0 — no effects run here, see SCOPE LIMIT above) the brand
			// is fully inside the visible scrollport, so the pane opens showing the brand
			// rather than needing a scroll-up to find it.
			expect(probe.scrollTop).toBe(0);
			expect(probe.brandVisible).toBe(true);
			// The mark renders at the requested 20px, not the PNG's intrinsic 128px, so the
			// brand is a compact line rather than a band dominating a 320px pane.
			expect(probe.markSize).toEqual({ w: 20, h: 20 });
			expect(probe.brandHeight).toBeLessThan(48);
			// Brand sits above the starters.
			expect(probe.brandTop).toBeLessThan(probe.firstPillTop);
			// Starters really stack: one column (shared left edge, increasing top).
			expect(probe.pillsStacked).toBe(true);
			expect(probe.pills).toHaveLength(SKILL_PILLS.length);
			const lefts = new Set(probe.pills.map(p => p.left));
			expect(lefts.size).toBe(1);
			for (let i = 1; i < probe.pills.length; i++) {
				expect(probe.pills[i].top).toBeGreaterThan(probe.pills[i - 1].top);
			}
			// Full-width rows, not shrink-wrapped chips.
			const widths = new Set(probe.pills.map(p => p.width));
			expect(widths.size).toBe(1);
		} finally {
			await browser.close();
		}
	}, 60_000);

	test("the control row clears Office's own top-right button, and tooltips appear on hover", async () => {
		const puppeteer = (await import("puppeteer")).default;
		const browser: Browser = await puppeteer.launch({
			headless: true,
			args: ["--no-sandbox", "--force-device-scale-factor=1"],
		});
		try {
			const page = await browser.newPage();
			await page.setViewport({ width: 320, height: 640, deviceScaleFactor: 1 });
			await page.setContent(harnessHtml([]), { waitUntil: "load" });

			const reserve = await page.evaluate(() => {
				const panel = document.querySelector(".xcsh-panel") as HTMLElement;
				const header = document.querySelector(".header") as HTMLElement;
				const buttons = Array.from(header.querySelectorAll<HTMLElement>(".header-btn"));
				const last = buttons[buttons.length - 1];
				return {
					count: buttons.length,
					paddingRight: Number.parseFloat(getComputedStyle(header).paddingRight),
					gap: panel.getBoundingClientRect().right - last.getBoundingClientRect().right,
					tipOpacity: getComputedStyle(last, "::after").opacity,
					tipContent: getComputedStyle(last, "::after").content,
				};
			});

			// All three controls, and the rightmost one keeps clear of the pane edge.
			expect(reserve.count).toBe(3);
			expect(reserve.paddingRight).toBeGreaterThanOrEqual(MIN_RIGHT_RESERVE);
			expect(reserve.gap).toBeGreaterThanOrEqual(MIN_RIGHT_RESERVE);
			// The tooltip exists, carries the button's label, and starts hidden.
			expect(reserve.tipContent).toContain("More options");
			expect(Number.parseFloat(reserve.tipOpacity)).toBe(0);

			// Hover → it becomes visible (allowing for the transition's ~350ms delay).
			await page.hover(".header-menuwrap:last-of-type .header-btn");
			await new Promise(r => setTimeout(r, 900));
			const hovered = await page.evaluate(() => {
				const buttons = Array.from(document.querySelectorAll<HTMLElement>(".header-btn"));
				const last = buttons[buttons.length - 1];
				const after = getComputedStyle(last, "::after");
				const panel = (document.querySelector(".xcsh-panel") as HTMLElement).getBoundingClientRect();
				const tipWidth = Number.parseFloat(after.width);
				return {
					opacity: Number.parseFloat(after.opacity),
					// right:0 anchors the tip to the button's right edge; on a 320px pane it
					// must not overflow the left side either.
					fitsPane: tipWidth <= panel.width,
				};
			});
			await page.screenshot({ path: join(OUT_DIR, "shell-tooltip-320.png") });
			await page.close();

			expect(hovered.opacity).toBe(1);
			expect(hovered.fitsPane).toBe(true);
		} finally {
			await browser.close();
		}
	}, 60_000);
});
