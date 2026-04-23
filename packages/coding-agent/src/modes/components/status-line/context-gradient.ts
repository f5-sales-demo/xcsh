/**
 * 21-step context-usage color gradient. Each entry pairs a background
 * hex color with its WCAG-AA-optimal foreground (#ffffff or #000000).
 * Both xcsh-dark and xcsh-light themes use this single gradient on the
 * context-percent badge.
 */

export interface ContextGradientColors {
	readonly pct: number;
	readonly bg: string;
	readonly fg: string;
}

const GRADIENT_STEPS: readonly Omit<ContextGradientColors, never>[] = [
	{ pct: 0, bg: "#0d1b3e", fg: "#ffffff" },
	{ pct: 5, bg: "#1a3a6e", fg: "#ffffff" },
	{ pct: 10, bg: "#1a4399", fg: "#ffffff" },
	{ pct: 15, bg: "#1565c0", fg: "#ffffff" },
	{ pct: 20, bg: "#0277bd", fg: "#ffffff" },
	{ pct: 25, bg: "#00838f", fg: "#000000" },
	{ pct: 30, bg: "#00897b", fg: "#000000" },
	{ pct: 35, bg: "#43a047", fg: "#000000" },
	{ pct: 40, bg: "#558b2f", fg: "#000000" },
	{ pct: 45, bg: "#9e9d24", fg: "#000000" },
	{ pct: 50, bg: "#f9a825", fg: "#000000" },
	{ pct: 55, bg: "#ff8f00", fg: "#000000" },
	{ pct: 60, bg: "#ef6c00", fg: "#000000" },
	{ pct: 65, bg: "#e65100", fg: "#000000" },
	{ pct: 70, bg: "#d84315", fg: "#000000" },
	{ pct: 75, bg: "#c62828", fg: "#ffffff" },
	{ pct: 80, bg: "#b71c1c", fg: "#ffffff" },
	{ pct: 85, bg: "#880e4f", fg: "#ffffff" },
	{ pct: 90, bg: "#6a1b9a", fg: "#ffffff" },
	{ pct: 95, bg: "#4a148c", fg: "#ffffff" },
	{ pct: 100, bg: "#311b92", fg: "#ffffff" },
];

export const CONTEXT_GRADIENT: readonly ContextGradientColors[] = GRADIENT_STEPS.map(step =>
	Object.freeze({ pct: step.pct, bg: step.bg, fg: step.fg }),
);

/**
 * Return the gradient entry for a given context-usage percentage.
 *
 * Input is clamped to [0, 100]. NaN is coerced to 0 explicitly, because
 * naive `Math.max(0, Math.min(100, NaN))` returns NaN (both comparisons
 * propagate NaN), which would fall through the scan with no match.
 *
 * The same step is returned as a shared frozen singleton — callers can
 * safely hold references and compare with `===`.
 */
export function getContextGradientColors(contextPercent: number): ContextGradientColors {
	const clamped = Number.isNaN(contextPercent) ? 0 : Math.max(0, Math.min(100, contextPercent));

	let match = CONTEXT_GRADIENT[0];
	for (const entry of CONTEXT_GRADIENT) {
		if (entry.pct <= clamped) {
			match = entry;
		} else {
			break;
		}
	}
	return match;
}
