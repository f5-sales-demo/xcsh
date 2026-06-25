/**
 * F5 XC environment variable names. Typed `as const` so bracket access like
 * `process.env[XCSH_API_URL]` type-checks correctly. Single source of truth —
 * every consumer imports these instead of repeating the string literal.
 */
export const XCSH_API_URL = "XCSH_API_URL" as const;
export const XCSH_API_TOKEN = "XCSH_API_TOKEN" as const;
export const XCSH_NAMESPACE = "XCSH_NAMESPACE" as const;
export const XCSH_TENANT = "XCSH_TENANT" as const;
export const XCSH_USERNAME = "XCSH_USERNAME" as const;
export const XCSH_CONSOLE_PASSWORD = "XCSH_CONSOLE_PASSWORD" as const;
/** Active context profile name. Read-only metadata injected by ContextService. */
export const XCSH_CONTEXT_NAME = "XCSH_CONTEXT_NAME" as const;

export const RESERVED_ENV_KEYS: ReadonlySet<string> = new Set([
	XCSH_NAMESPACE,
	XCSH_API_URL,
	XCSH_API_TOKEN,
	XCSH_TENANT,
	XCSH_CONTEXT_NAME,
]);

export const RESERVED_ENV_MESSAGES: Readonly<Record<string, string>> = {
	[XCSH_NAMESPACE]: `${XCSH_NAMESPACE} is managed by defaultNamespace. Use /context namespace <value> to change it.`,
	[XCSH_API_URL]: `${XCSH_API_URL} is managed by apiUrl. It cannot be overridden via env vars.`,
	[XCSH_API_TOKEN]: `${XCSH_API_TOKEN} is managed by apiToken. It cannot be overridden via env vars.`,
	[XCSH_TENANT]: `${XCSH_TENANT} is read-only (derived from apiUrl). It cannot be set directly.`,
	[XCSH_CONTEXT_NAME]: `${XCSH_CONTEXT_NAME} is read-only (injected by ContextService on activation). It cannot be set directly.`,
};

/**
 * True iff an env var is overriding a context-provided credential.
 * XCSH_API_URL alone is NOT an override — it is the signal that the user
 * wants to bypass contexts entirely (see ContextService.loadActive FR-102).
 * The "override" concept only applies to token/namespace supplied alongside
 * a loaded context.
 */
export function hasEnvOverride(): boolean {
	return !!process.env[XCSH_API_TOKEN] || !!process.env[XCSH_NAMESPACE];
}

/**
 * RFC 1123 DNS label: 1–63 chars, alphanumeric edges, hyphens allowed only
 * in the interior. Case-insensitive; matched URL hostname is lowercased.
 */
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Derive the tenant name (first DNS label) from an API URL.
 *
 * Returns null when:
 *   - the URL fails to parse
 *   - the hostname is dotless (e.g. `localhost`)
 *   - the first label does not match the RFC 1123 DNS label rule
 *
 * Known edge case: IP-address URLs like `https://192.168.1.1` return `"192"`
 * because a numeric label is technically a valid DNS label. This is
 * out-of-spec for F5 XC tenant URLs and the misconfiguration surfaces
 * visibly in the UI.
 */
export function deriveTenantFromUrl(url: string): string | null {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return null;
	}
	if (!hostname.includes(".")) return null;
	const label = hostname.split(".")[0].toLowerCase();
	return DNS_LABEL_RE.test(label) ? label : null;
}

/**
 * Reduce an API URL to its origin (`https://host[:port]`) — the canonical stored
 * form for a context endpoint.
 *
 * Strips any path, query, fragment, or trailing slash so the stored value is the
 * bare origin: callers append `/api/...` (and other path patterns) themselves,
 * keeping one consistent value that other tooling can reuse (e.g. a
 * browser-automation login URL that cannot carry a suffix). This also prevents a
 * pasted browser URL (e.g. `https://host/web/home?iss=...`) from corrupting the
 * `${apiUrl}${path}` joins in XCSHApiClient / ResourceClient. Falls back to
 * trailing-slash stripping for an unparseable value.
 */
export function normalizeApiUrl(url: string): string {
	if (typeof url !== "string") return url;
	const trimmed = url.trim();
	try {
		return new URL(trimmed).origin;
	} catch {
		return trimmed.replace(/\/+$/, "");
	}
}
