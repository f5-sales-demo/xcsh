import type { ProfileStatus } from "./f5xc-profile";

/**
 * Compose the canonical `<tenant|name|env>:<namespace|default>` label used by
 * the status-line segment and any future single-line profile display.
 *
 * Fallback chain for the left side: tenant → profile name → "env"
 * (the final fallback reflects env-backed sessions with no profile loaded).
 * Right side defaults to `"default"` when no namespace is set.
 */
export function formatProfileLabel(status: ProfileStatus): string {
	const left = status.activeProfileTenant ?? status.activeProfileName ?? "env";
	const right = status.activeProfileNamespace ?? "default";
	return `${left}:${right}`;
}
