import type { Component } from "@f5-sales-demo/pi-tui";
import { APP_NAME } from "@f5-sales-demo/pi-utils";
import { theme } from "../../modes/theme/theme";
import { selectorFrame, selectorFrameContentWidth } from "./selector-frame";

/**
 * Startup splash: the F5 logo under a ` xcsh vX.Y.Z ` title bar. Intentionally
 * static and status-free — session/provider/plugin status lives in on-demand
 * commands (/plugins, /context) so startup stays instant and never blocks or
 * live-updates. See docs/superpowers/specs for the fast-startup design.
 */
// biome-ignore format: preserve ASCII art layout
/** The F5 "ball" startup logo. Rows are vertically symmetric so the disk renders as a
 * clean circle; keep it that way (see welcome-logo.test.ts). `▓`→red, `█`→white,
 * `▒`→red stipple halo, `()|_`→red edge glyphs (see WelcomeComponent.#f5ColorLine). */
export const F5_LOGO_ROWS: readonly string[] = [
	"                   ________",
	"              (▒▒▒▒▓▓▓▓▓▓▓▓▒▒▒▒)",
	"         (▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒)",
	"      (▒▒▓▓▓▓██████████▓▓▓▓█████████████)",
	"    (▒▓▓▓▓██████▒▒▒▒▒███▓▓██████████████▒)",
	"   (▒▓▓▓▓██████▒▓▓▓▓▓▒▒▒▓██▒▒▒▒▒▒▒▒▒▒▒▒▒▓▒)",
	"  (▒▓▓▓▓▓██████▓▓▓▓▓▓▓▓▓██▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒)",
	" (▒▓▓███████████████▓▓▓▓█████████████▓▓▓▓▓▓▒)",
	"(▒▓▓▓▒▒▒███████▒▒▒▒▒▓▓▓████████████████▓▓▓▓▓▒)",
	"|▒▓▓▓▓▓▓▒██████▓▓▓▓▓▓▓████████████████████▓▓▒|",
	"|▒▓▓▓▓▓▓▓██████▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒██████████▓▒|",
	"(▒▓▓▓▓▓▓▓██████▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒████████▒▒)",
	" (▒▓▓▓▓▓▓██████▓▓▓▓▓▓▓███▓▓▓▓▓▓▓▓▓▓▒▒▒████▒▒)",
	"  (▒▓▓▓▓▓██████▓▓▓▓▓▓█████▓▓▓▓▓▓▓▓▓▓▓▓███▒▒)",
	"   (▒▒██████████▓▓▓▓▓▒██████▓▓▓▓▓▓▓▓███▒▒▒)",
	"    (▒▒▒▒▒██████████▓▓▒▒█████████████▒▒▓▒)",
	"      (▒▓▓▒▒▒▒▒▒▒▒▒▒▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▓▒)",
	"         (▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒)",
	"              (▒▒▒▒▓▓▓▓▓▓▓▓▒▒▒▒)",
];

const FULL_LOGO_MIN_WIDTH = 50;
const FULL_LOGO_CANVAS_WIDTH = 46;
// The 46-column artwork fits inside the shared frame's one-column gutters at 50 columns.
const MAX_FRAME_WIDTH = 50;
const blankRow = { content: "", selected: false } as const;

export class WelcomeComponent implements Component {
	constructor(private readonly version: string) {}
	invalidate(): void {}

	render(termWidth: number): string[] {
		if (termWidth < 5) return [];
		const width = Math.min(MAX_FRAME_WIDTH, termWidth);
		const contentWidth = selectorFrameContentWidth(width);
		const fullLogo = termWidth >= FULL_LOGO_MIN_WIDTH;
		const logo = fullLogo
			? F5_LOGO_ROWS.map(line => this.#centerInCanvas(this.#f5ColorLine(line), FULL_LOGO_CANVAS_WIDTH, contentWidth))
			: [this.#centerInCanvas(theme.bold(theme.fg("accent", "F5")), 2, contentWidth)];
		// The underscore crown already reads as the logo's top spacing. Keep a single
		// blank row only below the mark so the framed splash does not look top-heavy.
		const body = [...logo, blankRow];
		return selectorFrame(width, body.length + 4, `${APP_NAME} v${this.version}`, "", [], body, [], []);
	}

	#centerInCanvas(value: string, canvasWidth: number, contentWidth: number): string {
		const left = Math.floor((contentWidth - canvasWidth) / 2);
		const right = contentWidth - canvasWidth - left;
		return `${" ".repeat(Math.max(0, left))}${value}${" ".repeat(Math.max(0, right))}`;
	}

	#f5ColorLine(line: string): string {
		const red = "\x1b[38;5;160m";
		const white = "\x1b[1;37m";
		// Explicit dark-red bg for the ▒ halo so the stipple reads as a
		// consistent mid-dark red regardless of terminal background; without
		// this the terminal bg leaks through half of each cell and the
		// drop-shadow effect washes out on light terminals.
		const shadowBg = "\x1b[48;5;88m";
		const reset = "\x1b[0m";
		let result = "";
		for (const char of line) {
			if (char === "▓") result += `${red}█${reset}`;
			else if (char === "█") result += `${white}█${reset}`;
			else if (char === "▒") result += `${red}${shadowBg}▒${reset}`;
			else if ("()|_".includes(char)) result += `${red}${char}${reset}`;
			else result += char;
		}
		return result;
	}
}
