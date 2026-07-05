import { type Component, padding, truncateToWidth, visibleWidth } from "@f5-sales-demo/pi-tui";
import { APP_NAME } from "@f5-sales-demo/pi-utils";
import { theme } from "../../modes/theme/theme";

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
	constructor(private readonly version: string) {}
	invalidate(): void {}

	render(termWidth: number): string[] {
		const preferredLeftCol = 50;
		const logoMaxWidth = 46;

		const boxWidth = Math.min(preferredLeftCol + 2, Math.max(0, termWidth - 2));
		if (boxWidth < 4) return [];
		const leftCol = boxWidth - 2;

		const f5Logo = F5_LOGO_ROWS;

		const logoColored = f5Logo.map(line => this.#f5ColorLine(line));
		const logoBlockPad = Math.max(0, Math.floor((leftCol - logoMaxWidth) / 2));
		const logoPadStr = padding(logoBlockPad);
		const contentLines = [...logoColored.map(l => logoPadStr + l), ""];

		const border = (s: string) => theme.fg("borderMuted", s);
		const hChar = theme.boxRound.horizontal;
		const h = border(hChar);
		const v = border(theme.boxRound.vertical);
		const tl = border(theme.boxRound.topLeft);
		const tr = border(theme.boxRound.topRight);
		const bl = border(theme.boxRound.bottomLeft);
		const br = border(theme.boxRound.bottomRight);

		const lines: string[] = [];
		const title = ` ${APP_NAME} v${this.version} `;
		const titlePrefixRaw = hChar.repeat(3);
		const titleStyled = border(titlePrefixRaw) + theme.bold(theme.fg("text", title));
		const titleVisLen = visibleWidth(titlePrefixRaw) + visibleWidth(title);
		const titleSpace = boxWidth - 2;
		if (titleVisLen >= titleSpace) {
			lines.push(tl + truncateToWidth(titleStyled, titleSpace) + tr);
		} else {
			lines.push(tl + titleStyled + border(hChar.repeat(titleSpace - titleVisLen)) + tr);
		}
		for (const line of contentLines) {
			lines.push(v + this.#fitToWidth(line, leftCol) + v);
		}
		lines.push(bl + h.repeat(leftCol) + br);
		return lines;
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

	#fitToWidth(str: string, width: number): string {
		const visLen = visibleWidth(str);
		if (visLen > width) {
			const ellipsis = "…";
			const maxW = Math.max(0, width - visibleWidth(ellipsis));
			let t = "";
			let cw = 0;
			let esc = false;
			for (const ch of str) {
				if (ch === "\x1b") esc = true;
				if (esc) {
					t += ch;
					if (ch === "m") esc = false;
				} else if (cw < maxW) {
					t += ch;
					cw++;
				}
			}
			return `${t}${ellipsis}`;
		}
		return str + padding(width - visLen);
	}
}
