import { describe, expect, test } from "bun:test";
import {
	CONTEXT_GRADIENT,
	getContextGradientColors,
} from "../../../../src/modes/components/status-line/context-gradient";

// WCAG 2 relative-luminance helpers (sRGB), inline so the test file has no
// production dependencies beyond the module under test.
function srgbLinearize(c: number): number {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
	const h = hex.replace("#", "");
	const r = srgbLinearize(parseInt(h.substring(0, 2), 16));
	const g = srgbLinearize(parseInt(h.substring(2, 4), 16));
	const b = srgbLinearize(parseInt(h.substring(4, 6), 16));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
	const l1 = relativeLuminance(hex1);
	const l2 = relativeLuminance(hex2);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

describe("getContextGradientColors: exact values", () => {
	test("0% returns deep navy bg with white fg", () => {
		const colors = getContextGradientColors(0);
		expect(colors.bg).toBe("#0d1b3e");
		expect(colors.fg).toBe("#ffffff");
	});

	test("50% returns amber bg with black fg", () => {
		const colors = getContextGradientColors(50);
		expect(colors.bg).toBe("#f9a825");
		expect(colors.fg).toBe("#000000");
	});

	test("100% returns indigo-purple bg with white fg", () => {
		const colors = getContextGradientColors(100);
		expect(colors.bg).toBe("#311b92");
		expect(colors.fg).toBe("#ffffff");
	});
});

describe("getContextGradientColors: clamping", () => {
	test("negative percent snaps to 0% entry", () => {
		expect(getContextGradientColors(-5)).toEqual(getContextGradientColors(0));
		expect(getContextGradientColors(-100)).toEqual(getContextGradientColors(0));
	});

	test("percent above 100 snaps to 100% entry", () => {
		expect(getContextGradientColors(101)).toEqual(getContextGradientColors(100));
		expect(getContextGradientColors(9999)).toEqual(getContextGradientColors(100));
	});

	test("NaN snaps to 0% entry", () => {
		// Guards against naive Math.max(0, Math.min(100, NaN)) which returns NaN.
		expect(getContextGradientColors(Number.NaN)).toEqual(getContextGradientColors(0));
	});
});

describe("getContextGradientColors: step snapping", () => {
	test("3% snaps to the 0% step", () => {
		expect(getContextGradientColors(3)).toEqual(getContextGradientColors(0));
	});

	test("7% snaps to the 5% step", () => {
		expect(getContextGradientColors(7)).toEqual(getContextGradientColors(5));
	});

	test("52% snaps to the 50% step", () => {
		expect(getContextGradientColors(52)).toEqual(getContextGradientColors(50));
	});

	test("99% snaps to the 95% step", () => {
		expect(getContextGradientColors(99)).toEqual(getContextGradientColors(95));
	});
});

describe("getContextGradientColors: fg color zones", () => {
	test("white fg for every step 0-20%", () => {
		for (const pct of [0, 5, 10, 15, 20]) {
			expect(getContextGradientColors(pct).fg).toBe("#ffffff");
		}
	});

	test("black fg for every step 25-70%", () => {
		for (const pct of [25, 30, 35, 40, 45, 50, 55, 60, 65, 70]) {
			expect(getContextGradientColors(pct).fg).toBe("#000000");
		}
	});

	test("white fg for every step 75-100%", () => {
		for (const pct of [75, 80, 85, 90, 95, 100]) {
			expect(getContextGradientColors(pct).fg).toBe("#ffffff");
		}
	});
});

describe("getContextGradientColors: WCAG 2 AA contrast", () => {
	test("every 5% step meets 4.5:1 minimum", () => {
		for (let pct = 0; pct <= 100; pct += 5) {
			const { bg, fg } = getContextGradientColors(pct);
			const ratio = contrastRatio(bg, fg);
			expect(ratio).toBeGreaterThanOrEqual(4.5);
		}
	});
});

describe("getContextGradientColors: returned object identity", () => {
	test("returned object is frozen", () => {
		expect(Object.isFrozen(getContextGradientColors(50))).toBe(true);
	});

	test("same step returns the same object (shared singleton)", () => {
		expect(getContextGradientColors(50)).toBe(getContextGradientColors(52));
		expect(getContextGradientColors(0)).toBe(getContextGradientColors(3));
	});
});

describe("CONTEXT_GRADIENT table integrity", () => {
	test("has exactly 21 entries", () => {
		expect(CONTEXT_GRADIENT).toHaveLength(21);
	});

	test("entries are ordered by pct ascending in steps of 5", () => {
		CONTEXT_GRADIENT.forEach((entry, idx) => {
			expect(entry.pct).toBe(idx * 5);
		});
	});

	test("all 21 bg values are distinct", () => {
		const bgs = new Set(CONTEXT_GRADIENT.map(e => e.bg));
		expect(bgs.size).toBe(21);
	});
});
