import { describe, expect, it } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { F5_LOGO_ROWS, WelcomeComponent } from "../src/modes/components/welcome";
import { getThemeByName, setThemeInstance } from "../src/modes/theme/theme";

it("welcome reserves space for the editor and adapts without clipping the logo on resize", async () => {
	setThemeInstance((await getThemeByName("xcsh-dark"))!);
	let rows = 20;
	const welcome = new WelcomeComponent("fixture", () => rows);
	for (const [width, height] of [
		[60, 20],
		[80, 24],
		[100, 32],
		[140, 40],
	]) {
		rows = height;
		const lines = welcome.render(width);
		expect(lines.length).toBeLessThanOrEqual(6);
		expect(lines.every(line => visibleWidth(line) <= Math.min(width, 100))).toBe(true);
		expect(Bun.stripANSI(lines.join("\n"))).toContain("xcsh vfixture");
		expect(Bun.stripANSI(lines.join("\n"))).toContain("F5");
	}
	rows = 80;
	expect(welcome.render(100).length).toBeGreaterThan(F5_LOGO_ROWS.length);
	rows = 20;
	expect(welcome.render(100).length).toBeLessThanOrEqual(6);
	expect(welcome.render(30).every(line => visibleWidth(line) <= 30)).toBe(true);
});

/**
 * Regression guard for the F5 startup logo (issue #1863).
 *
 * The logo rendered badly skewed after PR #1852 re-drew the bitmap into a
 * vertically-ASYMMETRIC shape (mirror rows differed in width by up to 3 cells),
 * so the disk was lopsided and the `( ) |` edge glyphs no longer traced a clean
 * circle. A clean disk requires the circle rows to mirror top<->bottom in width
 * and to form a single rise-then-fall (unimodal) profile. These pin that shape so
 * a future redraw cannot silently skew the logo again.
 */
describe("F5 logo art (welcome screen)", () => {
	// Row 0 is the "________" crown (intentionally not part of the disk); the rest is the circle.
	const circle = F5_LOGO_ROWS.slice(1);
	const width = (s: string): number => [...s].length;

	it("has an even number of vertically-mirrored circle rows", () => {
		expect(circle.length % 2).toBe(0);
	});

	it("is vertically symmetric — mirrored rows match width within 1 cell (a clean circle, not skewed)", () => {
		const n = circle.length;
		const offenders: string[] = [];
		for (let i = 0; i < Math.floor(n / 2); i++) {
			const top = width(circle[i]);
			const bot = width(circle[n - 1 - i]);
			if (Math.abs(top - bot) > 1)
				offenders.push(`row ${i} (w=${top}) vs row ${n - 1 - i} (w=${bot}) differ by ${Math.abs(top - bot)}`);
		}
		expect(offenders).toEqual([]);
	});

	it("has a unimodal profile — widths rise to the middle then fall, with no dips", () => {
		const w = circle.map(width);
		const peak = Math.max(...w);
		const firstPeak = w.indexOf(peak);
		const lastPeak = w.lastIndexOf(peak);
		for (let i = 1; i <= firstPeak; i++) expect(w[i]).toBeGreaterThanOrEqual(w[i - 1]);
		for (let i = lastPeak + 1; i < w.length; i++) expect(w[i]).toBeLessThanOrEqual(w[i - 1]);
	});
});
