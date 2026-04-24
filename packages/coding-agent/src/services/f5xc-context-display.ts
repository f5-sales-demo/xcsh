import type { ContextStatus } from "./f5xc-context";

/**
 * Compose the canonical `<tenant|name|env>:<namespace|default>` label used by
 * the status-line segment and any future single-line context display.
 *
 * Fallback chain for the left side: tenant → context name → "env"
 * (the final fallback reflects env-backed sessions with no context loaded).
 * Right side defaults to `"default"` when no namespace is set.
 */
export function formatContextLabel(status: ContextStatus): string {
	const left = status.activeContextTenant ?? status.activeContextName ?? "env";
	const right = status.activeContextNamespace ?? "default";
	return `${left}:${right}`;
}
