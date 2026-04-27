import type { ContextStatus } from "./f5xc-context";

export function formatContextLabel(status: ContextStatus): string {
	const left = status.activeContextTenant ?? status.activeContextName ?? "env";
	const right = status.activeContextNamespace ?? "default";
	const base = `${left}:${right}`;
	if (status.tokenHealth === "expiring" || status.tokenHealth === "expired") return `${base} ⚠`;
	return base;
}
