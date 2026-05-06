import { type Component, padding, truncateToWidth, visibleWidth } from "@f5xc-salesdemos/pi-tui";
import { APP_NAME } from "@f5xc-salesdemos/pi-utils";
import { theme } from "../../modes/theme/theme";
import { formatStatusIcon } from "../../services/f5xc-context-indicators";
import type { ModelStatus, ServiceStatus, WelcomeProfileStatus } from "./welcome-checks";

export interface UpdateStatus {
	available: boolean;
	latestVersion?: string;
}

export class WelcomeComponent implements Component {
	constructor(
		private readonly version: string,
		private modelStatus: ModelStatus,
		private services: ServiceStatus[] = [],
		private updateStatus?: UpdateStatus,
		private profileStatus?: WelcomeProfileStatus,
	) {}
	invalidate(): void {}
	setModelStatus(status: ModelStatus): void {
		this.modelStatus = status;
	}
	setServices(services: ServiceStatus[]): void {
		this.services = services;
	}
	setUpdateStatus(status: UpdateStatus | undefined): void {
		this.updateStatus = status;
	}
	setProfileStatus(status: WelcomeProfileStatus | undefined): void {
		this.profileStatus = status;
	}

	render(termWidth: number): string[] {
		const minLeftCol = 48;
		const minRightCol = 20;
		const preferredLeftCol = 50;

		// Content-driven right column width
		const naturalRight = this.#measureStatusWidth() + 1; // +1 right padding
		const idealRight = Math.max(naturalRight, minRightCol);
		const idealBox = preferredLeftCol + idealRight + 3; // 3 border chars: │ + │ + │
		const boxWidth = Math.min(idealBox, Math.max(0, termWidth - 2));
		if (boxWidth < 4) return [];

		const dualContentWidth = boxWidth - 3;
		// When terminal is narrower than ideal, shrink left column toward minLeftCol first
		const dualLeftCol =
			dualContentWidth >= preferredLeftCol + idealRight
				? preferredLeftCol
				: Math.max(minLeftCol, dualContentWidth - idealRight);
		const dualRightCol = Math.max(0, dualContentWidth - dualLeftCol);
		// Only show dual column when both columns have enough room for their content
		const showRightColumn = dualLeftCol >= minLeftCol && dualRightCol >= Math.max(minRightCol, naturalRight);
		const leftCol = showRightColumn ? dualLeftCol : boxWidth - 2;
		const rightCol = showRightColumn ? dualRightCol : 0;

		// biome-ignore format: preserve ASCII art layout
		const f5Logo = [
			"                   ________",
			"              (\u2592\u2592\u2592\u2592\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2592\u2592\u2592\u2592)",
			"         (\u2592\u2592\u2592\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2592\u2592\u2592)",
			"      (\u2592\u2592\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588)",
			"    (\u2592\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2592\u2592\u2592\u2592\u2592\u2588\u2588\u2588\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2592)",
			"   (\u2592\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2592\u2593\u2593\u2593\u2593\u2593\u2592\u2592\u2592\u2593\u2588\u2588\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2593\u2592)",
			"  (\u2592\u2593\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2588\u2588\u2592\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2592)",
			" (\u2592\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2593\u2592)",
			"(\u2592\u2593\u2593\u2593\u2592\u2592\u2592\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2592\u2592\u2592\u2592\u2592\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2592)",
			"|\u2592\u2593\u2593\u2593\u2593\u2593\u2593\u2592\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2592|",
			"|\u2592\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2592|",
			"(\u2592\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2592\u2592\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2592\u2592)",
			" (\u2592\u2593\u2593\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2592\u2592\u2592\u2588\u2588\u2588\u2588\u2592\u2592)",
			"  (\u2592\u2593\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2592\u2592)",
			"   (\u2592\u2592\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2592\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2588\u2588\u2588\u2592\u2592\u2592)",
			"    (\u2592\u2592\u2592\u2592\u2592\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2593\u2593\u2592\u2592\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2592\u2592\u2593\u2592)",
			"      (\u2592\u2593\u2593\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2593\u2593\u2593\u2593\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2592\u2593\u2592)",
			"         (\u2592\u2592\u2592\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2592\u2592\u2592)",
			"              (\u2592\u2592\u2592\u2592\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2592\u2592\u2592\u2592)",
		];

		const logoColored = f5Logo.map(line => this.#f5ColorLine(line));
		const logoMaxWidth = 46;
		const logoBlockPad = Math.max(0, Math.floor((leftCol - logoMaxWidth) / 2));
		const logoPadStr = padding(logoBlockPad);
		const leftLines = [...logoColored.map(l => logoPadStr + l), ""];
		const rightLines = this.#buildStatusLines(showRightColumn ? rightCol : leftCol);
		if (!showRightColumn) {
			leftLines.push(...rightLines);
		}
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
		const maxRows = showRightColumn ? Math.max(leftLines.length, rightLines.length) : leftLines.length;
		for (let i = 0; i < maxRows; i++) {
			const left = this.#fitToWidth(leftLines[i] ?? "", leftCol);
			if (showRightColumn) {
				const right = this.#fitToWidth(rightLines[i] ?? "", rightCol);
				lines.push(v + left + v + right + v);
			} else {
				lines.push(v + left + v);
			}
		}
		if (showRightColumn) {
			lines.push(bl + h.repeat(leftCol) + border(theme.boxSharp.teeUp) + h.repeat(rightCol) + br);
		} else {
			lines.push(bl + h.repeat(leftCol) + br);
		}
		return lines;
	}

	#measureStatusWidth(): number {
		const lines: string[] = [" Model Provider", ...this.#renderModelStatus()];
		for (const svc of this.services) {
			lines.push(this.#renderServiceLine(svc));
		}
		if (this.profileStatus) {
			lines.push(" User Profile", ...this.#renderProfileStatus());
		}
		if (this.#showUpdateSection()) {
			lines.push(this.#renderUpdateLine());
		}
		return Math.max(...lines.map(l => visibleWidth(l)));
	}

	#buildStatusLines(rightCol: number): string[] {
		const lines: string[] = [];
		const separatorWidth = Math.max(0, rightCol - 2);
		const separator = ` ${theme.fg("muted", theme.boxRound.horizontal.repeat(separatorWidth))}`;
		lines.push("");
		lines.push(` ${theme.bold(theme.fg("contentAccent", "Model Provider"))}`);
		lines.push(...this.#renderModelStatus());
		lines.push("");
		if (this.services.length > 0 || this.#showUpdateSection()) {
			lines.push(separator);
			for (const svc of this.services) {
				lines.push(this.#renderServiceLine(svc));
			}
			if (this.#showUpdateSection()) {
				lines.push(this.#renderUpdateLine());
			}
		}
		if (this.profileStatus) {
			lines.push(separator);
			for (const line of this.#renderProfileStatus()) {
				lines.push(line);
			}
		}
		lines.push("");
		return lines;
	}

	#showUpdateSection(): boolean {
		return this.updateStatus?.available === true;
	}

	#renderServiceLine(service: ServiceStatus): string {
		if (service.state === "connected") {
			return ` ${formatStatusIcon("connected")} ${theme.fg("muted", service.name)}`;
		}
		const hint = service.hint ?? "";
		return ` ${formatStatusIcon("warning")} ${theme.fg("muted", service.name)}  ${theme.fg("dim", hint)}`;
	}

	#renderUpdateLine(): string {
		const latest = this.updateStatus?.latestVersion;
		const label = latest ? `v${latest}` : "new version";
		return ` ${theme.fg("warning", "↑")} ${theme.fg("muted", label)}  ${theme.fg("dim", "run: xcsh update")}`;
	}

	#renderModelStatus(): string[] {
		const { state, provider } = this.modelStatus;
		const p = provider ?? "unknown";
		switch (state) {
			case "connected":
				return [` ${formatStatusIcon("connected")} ${theme.fg("muted", p)}`];
			case "auth_error":
				return [
					` ${formatStatusIcon("error")} ${theme.fg("muted", p)} ${theme.fg("error", "\u2014 connection failed")}`,
					`   ${theme.fg("dim", "Run /login to reconnect")}`,
				];
			case "no_provider":
				return [
					` ${formatStatusIcon("error")} ${theme.fg("error", "No model provider configured")}`,
					`   ${theme.fg("dim", "Run /login to connect")}`,
				];
		}
	}

	#renderProfileStatus(): string[] {
		if (!this.profileStatus) return [];
		const { state, name, staleDays } = this.profileStatus;
		switch (state) {
			case "current":
				return [` ${formatStatusIcon("connected")} ${theme.fg("muted", name ?? "profile loaded")}`];
			case "stale":
				return [
					` ${formatStatusIcon("warning")} ${theme.fg("muted", name ?? "profile")} ${theme.fg("warning", `\u2014 stale${staleDays !== undefined ? ` (${staleDays}d)` : ""}`)}`,
					`   ${theme.fg("dim", "Run")} ${theme.fg("contentAccent", "xcsh://user?seed=true")}`,
				];
			case "missing":
				return [
					` ${formatStatusIcon("warning")} ${theme.fg("warning", "No profile yet")}`,
					`   ${theme.fg("dim", "Run")} ${theme.fg("contentAccent", "xcsh://user?seed=true")}`,
				];
		}
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
			if (char === "\u2593") result += `${red}\u2588${reset}`;
			else if (char === "\u2588") result += `${white}\u2588${reset}`;
			else if (char === "\u2592") result += `${red}${shadowBg}\u2592${reset}`;
			else if ("()|_".includes(char)) result += `${red}${char}${reset}`;
			else result += char;
		}
		return result;
	}

	#fitToWidth(str: string, width: number): string {
		const visLen = visibleWidth(str);
		if (visLen > width) {
			const ellipsis = "\u2026";
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
