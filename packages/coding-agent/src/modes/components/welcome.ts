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

export class WelcomeComponent implements Component {
	constructor(
		private readonly version: string,
		private readonly terminalRows: () => number = () => process.stdout.rows || 24,
	) {}
	invalidate(): void {}

	render(termWidth: number): string[] {
		if (termWidth < 4) return [];
		const width = Math.min(52, termWidth);
		const budget = Math.max(4, Math.floor(this.terminalRows() / 2));
		const fullLogo = F5_LOGO_ROWS.length + 6 <= budget && selectorFrameContentWidth(width) >= 46;
		return selectorFrame(
			width,
			budget,
			`${APP_NAME} v${this.version}`,
			"",
			[],
			fullLogo ? F5_LOGO_ROWS.map(line => this.#f5ColorLine(line)) : [theme.bold(theme.fg("accent", "F5"))],
			[],
			[],
		);
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
