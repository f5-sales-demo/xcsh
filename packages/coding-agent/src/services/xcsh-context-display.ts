import type { ContextStatus } from "./xcsh-context";

export function formatContextLabel(status: ContextStatus): string {
	const left = status.activeContextTenant ?? status.activeContextName ?? "env";
	const right = status.activeContextNamespace ?? "default";
	const base = `${left}:${right}`;
	if (status.tokenHealth === "expiring" || status.tokenHealth === "expired") return `${base} ⚠`;
	return base;
}

export function truncateContextLabel(status: ContextStatus, maxWidth: number): string | null {
	if (!status.isConfigured) return null;

	const left = status.activeContextTenant ?? status.activeContextName ?? "env";
	const right = status.activeContextNamespace ?? "default";
	const hasWarning = status.tokenHealth === "expiring" || status.tokenHealth === "expired";
	const warningSuffix = hasWarning ? " ⚠" : "";
	const warningLen = warningSuffix.length;
	const available = maxWidth - warningLen;

	if (available < 4) return null;

	const full = `${left}:${right}`;
	if (full.length <= available) return `${full}${warningSuffix}`;

	// Tier 1: Truncate right side, keep full left
	if (available >= left.length + 3) {
		const rightMax = available - left.length - 1 - 1;
		return `${left}:${right.slice(0, rightMax)}…${warningSuffix}`;
	}

	// Tier 2: Abbreviate both sides
	if (available >= 6) {
		const contentBudget = available - 2;
		const leftBudget = Math.max(2, Math.ceil(contentBudget / 2));
		const rightBudget = contentBudget - leftBudget;
		const abbrLeft = left.slice(0, leftBudget);
		const abbrRight = rightBudget > 0 ? right.slice(0, rightBudget) : "";
		return `${abbrLeft}:${abbrRight}…${warningSuffix}`;
	}

	// Tier 3: Tenant abbreviation only
	if (available >= 4) {
		const leftBudget = available - 2;
		return `${left.slice(0, leftBudget)}:…${warningSuffix}`;
	}

	return null;
}
