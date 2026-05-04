import { type Component, padding, truncateToWidth, visibleWidth } from "@f5xc-salesdemos/pi-tui";
import { APP_NAME } from "@f5xc-salesdemos/pi-utils";
import { theme } from "../../modes/theme/theme";
import { formatStatusIcon } from "../../services/f5xc-context-indicators";
import type { ModelStatus, WelcomeContextStatus, WelcomeGitLabStatus } from "./welcome-checks";

export interface UpdateStatus {
	available: boolean;
	latestVersion?: string;
}

export interface ChangelogStatus {
	hasNew: boolean;
	version: string;
}

export class WelcomeComponent implements Component {
	constructor(
		private readonly version: string,
		private modelStatus: ModelStatus,
		private contextStatus?: WelcomeContextStatus,
		private updateStatus?: UpdateStatus,
		private changelogStatus?: ChangelogStatus,
		private gitlabStatus?: WelcomeGitLabStatus,
	) {}
	invalidate(): void {}
	setModelStatus(status: ModelStatus): void {
		this.modelStatus = status;
	}
	setContextStatus(status: WelcomeContextStatus | undefined): void {
		this.contextStatus = status;
	}
	setUpdateStatus(status: UpdateStatus | undefined): void {
		this.updateStatus = status;
	}
	setChangelogStatus(status: ChangelogStatus | undefined): void {
		this.changelogStatus = status;
	}
	setGitLabStatus(status: WelcomeGitLabStatus | undefined): void {
		this.gitlabStatus = status;
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
		const showRightColumn = dualLeftCol >= minLeftCol && dualRightCol >= minRightCol;
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
		const rightLines = this.#buildStatusLines(rightCol);
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
		if (this.contextStatus) {
			lines.push(" F5 XC Context", ...this.#renderContextStatus());
		}
		if (this.gitlabStatus) {
			lines.push(" GitLab", ...this.#renderGitLabStatus());
		}
		if (this.#showUpdateSection()) {
			lines.push(" Update Available", ...this.#renderUpdateStatus());
		}
		if (this.#showChangelogSection()) {
			lines.push(" What's New", ...this.#renderChangelogStatus());
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
		if (this.contextStatus) {
			lines.push(separator);
			lines.push("");
			lines.push(` ${theme.bold(theme.fg("contentAccent", "F5 XC Context"))}`);
			lines.push(...this.#renderContextStatus());
			lines.push("");
		}
		if (this.gitlabStatus) {
			lines.push(separator);
			lines.push("");
			lines.push(` ${theme.bold(theme.fg("contentAccent", "GitLab"))}`);
			lines.push(...this.#renderGitLabStatus());
			lines.push("");
		}
		if (this.#showUpdateSection()) {
			lines.push(separator);
			lines.push("");
			lines.push(` ${theme.bold(theme.fg("contentAccent", "Update Available"))}`);
			lines.push(...this.#renderUpdateStatus());
			lines.push("");
		}
		if (this.#showChangelogSection()) {
			lines.push(separator);
			lines.push("");
			lines.push(` ${theme.bold(theme.fg("contentAccent", "What's New"))}`);
			lines.push(...this.#renderChangelogStatus());
			lines.push("");
		}
		return lines;
	}

	#showUpdateSection(): boolean {
		return this.updateStatus?.available === true;
	}

	#showChangelogSection(): boolean {
		return this.changelogStatus?.hasNew === true;
	}

	#renderUpdateStatus(): string[] {
		const latest = this.updateStatus?.latestVersion;
		const label = latest ? `v${latest}` : "new version";
		return [
			` ${theme.fg("warning", "\u2191")} ${theme.fg("muted", label)}`,
			`   ${theme.fg("dim", "Run")} ${theme.fg("contentAccent", "xcsh update")}`,
		];
	}

	#renderChangelogStatus(): string[] {
		const v = this.changelogStatus?.version ?? this.version;
		return [
			` ${theme.fg("success", "\u2605")} ${theme.fg("muted", `v${v}`)}`,
			`   ${theme.fg("dim", "Run")} ${theme.fg("contentAccent", "/changelog")}`,
		];
	}

	#renderModelStatus(): string[] {
		const { state, provider } = this.modelStatus;
		const p = provider ?? "unknown";
		switch (state) {
			case "connected":
				return [` ${formatStatusIcon("connected")} ${theme.fg("muted", p)} ${theme.fg("dim", "\u2014 connected")}`];
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

	#renderContextStatus(): string[] {
		if (!this.contextStatus) return [];
		const { state, name } = this.contextStatus;
		const n = name ?? "(unknown)";
		switch (state) {
			case "connected":
				return [` ${formatStatusIcon("connected")} ${theme.fg("muted", n)} ${theme.fg("dim", "\u2014 connected")}`];
			case "auth_error":
				return [
					` ${formatStatusIcon("error")} ${theme.fg("muted", n)} ${theme.fg("error", "\u2014 token invalid")}`,
					`   ${theme.fg("dim", "Run /context to update")}`,
				];
			case "offline":
				if (this.contextStatus?.errorClass === "url_not_found") {
					return [
						` ${formatStatusIcon("error")} ${theme.fg("muted", n)} ${theme.fg("error", "\u2014 tenant not found")}`,
						`   ${theme.fg("dim", "Recreate with /context create or check with /context show")}`,
					];
				}
				return [
					` ${formatStatusIcon("warning")} ${theme.fg("muted", n)} ${theme.fg("warning", "\u2014 unreachable")}`,
					`   ${theme.fg("dim", "Check network, /context")}`,
				];
			case "no_context":
				return [
					` ${formatStatusIcon("warning")} ${theme.fg("warning", "No context configured")}`,
					`   ${theme.fg("dim", "Run /context create <name> <url> <token>")}`,
				];
		}
	}

	#renderGitLabStatus(): string[] {
		if (!this.gitlabStatus) return [];
		const { state, project } = this.gitlabStatus;
		switch (state) {
			case "connected":
				return [
					` ${formatStatusIcon("connected")} ${theme.fg("muted", project ?? "configured")} ${theme.fg("dim", "\u2014 connected")}`,
				];
			case "auth_error":
				return [
					` ${formatStatusIcon("error")} ${theme.fg("error", "Not authenticated")}`,
					`   ${theme.fg("dim", "Run")} ${theme.fg("contentAccent", "glab auth login")}`,
				];
			case "not_configured":
				return [
					` ${formatStatusIcon("warning")} ${theme.fg("warning", "No project configured")}`,
					`   ${theme.fg("dim", "Run glab_setup action save_project project GROUP/REPO")}`,
				];
			case "project_inaccessible":
				return [
					` ${formatStatusIcon("warning")} ${theme.fg("muted", project ?? "unknown")} ${theme.fg("warning", "\u2014 access denied")}`,
					`   ${theme.fg("dim", "Check permissions or run glab_setup with action save_project")}`,
				];
			case "not_installed":
				return [` ${formatStatusIcon("warning")} ${theme.fg("warning", "glab CLI not installed")}`];
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
