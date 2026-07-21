/**
 * Powerline status bar, embedded on the composer's top border (the xcsh TUI
 * style: the statusline IS the input box's top border, not a separate bar).
 * Promoted from the Chrome side-panel. Surface-appropriate signals only:
 *   left  → context% (model context-window usage; a 21-step teal→red gradient)
 *   right → the session identity (e.g. tenant·env / workspace) in F5 red
 * Segments bleed into slanted powerline caps drawn as CSS `clip-path` triangles
 * (`.sep-l`/`.sep-r` in panel.css.ts), each filled with its segment's background
 * so they read as seamless separators, matching the iTerm2/p10k statusline.
 */
import { COLORS, UI_COLORS } from "../theme/tokens";

const SESSION_FG = UI_COLORS.pureWhite;

// 21-step context-usage gradient (blue → teal → green → amber → red → purple).
// Pick the highest step whose pct ≤ value, exactly as the xcsh CLI.
const CONTEXT_GRADIENT: ReadonlyArray<{ pct: number; bg: string; fg: string }> = [
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

function gradientFor(pct: number): { bg: string; fg: string } {
	const v = Math.max(0, Math.min(100, pct));
	let chosen = CONTEXT_GRADIENT[0];
	for (const step of CONTEXT_GRADIENT) {
		if (step.pct <= v) chosen = step;
	}
	return chosen;
}

export interface StatusBarProps {
	contextPct: number | null;
	sessionLabel?: string;
}

export function StatusBar({ contextPct, sessionLabel }: StatusBarProps) {
	const g = contextPct != null ? gradientFor(contextPct) : null;
	return (
		<div className="statusbar">
			{g && (
				<span className="seg seg-context" style={{ background: g.bg, color: g.fg }}>
					{Math.round(contextPct as number)}%
					<span className="sep-r" style={{ background: g.bg }} />
				</span>
			)}
			<span className="seg-spacer" />
			{sessionLabel && (
				<span className="seg seg-session" style={{ background: COLORS.f5Red, color: SESSION_FG }}>
					<span className="sep-l" style={{ background: COLORS.f5Red }} />
					{sessionLabel}
				</span>
			)}
		</div>
	);
}
