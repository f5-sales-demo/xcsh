import type { AuthStatus } from "./xcsh-context";
import { formatStatusIcon } from "./xcsh-context-indicators";

// F5 Brand Red — same as welcome.ts line 203
const F5_RED = "\x1b[38;5;160m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// Box drawing chars — same as theme.ts lines 218-223
const BOX = {
	tl: "\u256D", // ╭
	tr: "\u256E", // ╮
	bl: "\u2570", // ╰
	br: "\u256F", // ╯
	h: "\u2500", // ─
	v: "\u2502", // │
	lt: "\u251C", // ├
	rt: "\u2524", // ┤
};

const r = (s: string) => `${F5_RED}${s}${RESET}`;

export function formatAuthIndicator(
	status: AuthStatus,
	latencyMs?: number,
	errorClass?: "network" | "credential" | "url_not_found",
): string {
	const ms = latencyMs !== undefined ? ` (${latencyMs}ms)` : "";
	switch (status) {
		case "connected":
			return `${formatStatusIcon("connected")} Connected${ms}`;
		case "auth_error":
			return `${formatStatusIcon("error")} Auth Error — check token${ms}`;
		case "offline":
			if (errorClass === "url_not_found") {
				return `${formatStatusIcon("error")} Offline — tenant URL not found${ms}`;
			}
			return `${formatStatusIcon("warning")} Offline — ${errorClass === "credential" ? "auth issue" : "network issue"}${ms}`;
		default:
			return `${formatStatusIcon("unknown")} Unknown`;
	}
}

export function formatRelativeTime(isoDate: string, now?: Date): string {
	const nowMs = (now ?? new Date()).getTime();
	const thenMs = new Date(isoDate).getTime();
	const diffMs = nowMs - thenMs;
	const absDiffMs = Math.abs(diffMs);
	const minutes = Math.floor(absDiffMs / 60_000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	const months = Math.floor(days / 30);

	if (months > 0) return `${months} month${months > 1 ? "s" : ""} ago`;
	if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
	if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
	if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
	return "just now";
}

export function formatExpiration(isoDate: string, now?: Date): string {
	const nowMs = (now ?? new Date()).getTime();
	const expiresMs = new Date(isoDate).getTime();
	const dateStr = isoDate.split("T")[0];
	const diffDays = Math.ceil((expiresMs - nowMs) / 86_400_000);

	if (diffDays < 0) {
		const ago = Math.abs(diffDays);
		return `${dateStr}  ${formatStatusIcon("warning")} expired ${ago} day${ago > 1 ? "s" : ""} ago`;
	}
	if (diffDays <= 7) {
		return `${dateStr}  ${formatStatusIcon("warning")} expires in ${diffDays} day${diffDays !== 1 ? "s" : ""}`;
	}
	return dateStr;
}

export function formatRotation(rotateAfterDays: number, lastRotatedAt?: string, now?: Date): string {
	const base = `every ${rotateAfterDays} days`;
	if (!lastRotatedAt) return base;
	const rotatedMs = new Date(lastRotatedAt).getTime();
	const nowMs = (now ?? new Date()).getTime();
	const thresholdMs = rotatedMs + rotateAfterDays * 86_400_000;
	if (nowMs >= thresholdMs) {
		const daysOverdue = Math.floor((nowMs - thresholdMs) / 86_400_000);
		const label = daysOverdue === 0 ? "overdue" : `overdue by ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""}`;
		return `${base}  ${formatStatusIcon("warning")} ${label}`;
	}
	const daysUntil = Math.ceil((thresholdMs - nowMs) / 86_400_000);
	if (daysUntil <= 7) {
		return `${base}  ${formatStatusIcon("warning")} rotation due in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`;
	}
	return base;
}

export interface TableRow {
	key: string;
	value: string;
}

export interface TableOptions {
	dividers?: Array<{ before: number; label: string }>;
}

// Measures the visible terminal column width of a string.
// Delegates to Bun.stringWidth() which strips ANSI escape sequences and handles
// Unicode wide characters — the same underlying function used by @f5xc-salesdemos/pi-tui.
const visibleWidth = (s: string): number => (s ? Bun.stringWidth(s) : 0);

export function renderXCShTable(title: string, rows: TableRow[], options?: TableOptions): string {
	// Calculate column widths using visibleWidth (handles ANSI and Unicode)
	const maxKey = Math.max(...rows.map(row => visibleWidth(row.key)), 0);
	const maxVal = Math.max(...rows.map(row => visibleWidth(row.value)), 0);
	// innerWidth = space + maxKey + 2-space separator + maxVal + space = maxKey + maxVal + 4
	const innerWidth = Math.max(maxKey + maxVal + 4, visibleWidth(title) + 2, 40);

	const lines: string[] = [];

	// Top border: ╭─ title ──────╮
	const titleText = ` ${title} `;
	const titlePad = innerWidth - visibleWidth(titleText) - 1;
	lines.push(`${r(BOX.tl + BOX.h)}${BOLD}${titleText}${RESET}${r(BOX.h.repeat(Math.max(0, titlePad)) + BOX.tr)}`);

	// Rows
	for (let i = 0; i < rows.length; i++) {
		// Optional labeled dividers
		const divider = options?.dividers?.find(d => d.before === i);
		if (divider) {
			const divLabel = ` ${divider.label} `;
			const divPad = innerWidth - visibleWidth(divLabel) - 1;
			lines.push(`${r(BOX.lt + BOX.h)}${BOLD}${divLabel}${RESET}${r(BOX.h.repeat(Math.max(0, divPad)) + BOX.rt)}`);
		}

		const { key, value } = rows[i];
		const keyPad = maxKey - visibleWidth(key);
		const valPad = innerWidth - maxKey - visibleWidth(value) - 4;
		lines.push(`${r(BOX.v)} ${key}${" ".repeat(keyPad)}  ${value}${" ".repeat(Math.max(0, valPad))} ${r(BOX.v)}`);
	}

	// Bottom border: ╰──────────────╯
	lines.push(r(BOX.bl + BOX.h.repeat(innerWidth) + BOX.br));

	return lines.join("\n");
}

export function renderContextMessage(title: string, body: string): string {
	const bodyLines = body.split("\n");
	const maxLine = Math.max(...bodyLines.map(l => visibleWidth(l)), 0);
	const innerWidth = Math.max(maxLine + 2, visibleWidth(title) + 3, 40);

	const lines: string[] = [];

	const titleText = ` ${title} `;
	const titlePad = innerWidth - visibleWidth(titleText) - 1;
	lines.push(`${r(BOX.tl + BOX.h)}${BOLD}${titleText}${RESET}${r(BOX.h.repeat(Math.max(0, titlePad)) + BOX.tr)}`);

	for (const bodyLine of bodyLines) {
		const pad = innerWidth - visibleWidth(bodyLine) - 2;
		lines.push(`${r(BOX.v)} ${bodyLine}${" ".repeat(Math.max(0, pad))} ${r(BOX.v)}`);
	}

	lines.push(r(BOX.bl + BOX.h.repeat(innerWidth) + BOX.br));

	return lines.join("\n");
}
