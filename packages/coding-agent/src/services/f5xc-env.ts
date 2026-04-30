/**
 * F5 XC environment variable names. Typed `as const` so bracket access like
 * `process.env[F5XC_API_URL]` type-checks correctly. Single source of truth —
 * every consumer imports these instead of repeating the string literal.
 */
export const F5XC_API_URL = "F5XC_API_URL" as const;
export const F5XC_API_TOKEN = "F5XC_API_TOKEN" as const;
export const F5XC_NAMESPACE = "F5XC_NAMESPACE" as const;
export const F5XC_TENANT = "F5XC_TENANT" as const;
export const F5XC_USERNAME = "F5XC_USERNAME" as const;
export const F5XC_CONSOLE_PASSWORD = "F5XC_CONSOLE_PASSWORD" as const;

export const RESERVED_ENV_KEYS: ReadonlySet<string> = new Set([
	F5XC_NAMESPACE,
	F5XC_API_URL,
	F5XC_API_TOKEN,
	F5XC_TENANT,
]);

export const RESERVED_ENV_MESSAGES: Readonly<Record<string, string>> = {
	[F5XC_NAMESPACE]: `${F5XC_NAMESPACE} is managed by defaultNamespace. Use /context namespace <value> to change it.`,
	[F5XC_API_URL]: `${F5XC_API_URL} is managed by apiUrl. It cannot be overridden via env vars.`,
	[F5XC_API_TOKEN]: `${F5XC_API_TOKEN} is managed by apiToken. It cannot be overridden via env vars.`,
	[F5XC_TENANT]: `${F5XC_TENANT} is read-only (derived from apiUrl). It cannot be set directly.`,
};

/**
 * True iff an env var is overriding a context-provided credential.
 * F5XC_API_URL alone is NOT an override — it is the signal that the user
 * wants to bypass contexts entirely (see ContextService.loadActive FR-102).
 * The "override" concept only applies to token/namespace supplied alongside
 * a loaded context.
 */
export function hasEnvOverride(): boolean {
	return !!process.env[F5XC_API_TOKEN] || !!process.env[F5XC_NAMESPACE];
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
