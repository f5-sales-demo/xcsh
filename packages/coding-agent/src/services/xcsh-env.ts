/**
 * F5 XC environment variable names + the reserved-key set. The single source of
 * truth lives in `@f5-sales-demo/pi-utils` (`xcsh-env-names`) so the shell and
 * the VS Code extension agree on the exact same names; re-exported here for the
 * shell's existing import paths.
 */
import {
	AUTH_ENV_KEYS,
	isInjectableContextEnvKey,
	isSensitiveEnvKey,
	RESERVED_ENV_KEYS,
	SECRET_ENV_PATTERNS,
	XCSH_API_TOKEN,
	XCSH_API_URL,
	XCSH_CONSOLE_PASSWORD,
	XCSH_CONTEXT_NAME,
	XCSH_NAMESPACE,
	XCSH_TENANT,
	XCSH_USERNAME,
} from "@f5-sales-demo/pi-utils";

export {
	AUTH_ENV_KEYS,
	isInjectableContextEnvKey,
	isSensitiveEnvKey,
	RESERVED_ENV_KEYS,
	SECRET_ENV_PATTERNS,
	XCSH_API_TOKEN,
	XCSH_API_URL,
	XCSH_CONSOLE_PASSWORD,
	XCSH_CONTEXT_NAME,
	XCSH_NAMESPACE,
	XCSH_TENANT,
	XCSH_USERNAME,
};

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

/** A tenant's unique session identity. Mirrors the extension's `sessionKeyFromUrl`
 * (xcsh-chrome-extension/src/tab-binding.ts) — keep the two in sync. */
export interface SessionKey {
	tenant: string;
	env: "production" | "staging";
}

/**
 * Map a console/login URL to its `(tenant, environment)` session key, or null.
 * Fail-closed and STRICTER than {@link deriveTenantFromUrl}: staging and
 * production of the same tenant name are distinct keys; the shared SaaS console
 * and `volterra` realm, IPs, and unrecognized hosts return null. Used by the
 * bridge handshake to tell the extension which tenant this xcsh process serves.
 */
export function sessionKeyFromUrl(url: string | undefined): SessionKey | null {
	if (!url) return null;
	let hostname: string;
	let path: string;
	try {
		const u = new URL(url);
		hostname = u.hostname.toLowerCase();
		path = u.pathname;
	} catch {
		return null;
	}
	const staging = hostname.match(/^([a-z0-9-]+)\.staging\.volterra\.us$/);
	if (staging && DNS_LABEL_RE.test(staging[1])) return { tenant: staging[1], env: "staging" };
	const prod = hostname.match(/^([a-z0-9-]+)\.console\.ves\.volterra\.io$/);
	if (prod && DNS_LABEL_RE.test(prod[1])) return { tenant: prod[1], env: "production" };
	const isLoginHost =
		hostname === "login.ves.volterra.io" ||
		hostname === "login-staging.volterra.us" ||
		/^login(-[a-z0-9]+)?\.volterra\.(us|io)$/.test(hostname);
	const oidc = path.match(/^\/auth\/realms\/([^/]+)\/protocol\/openid-connect/i);
	if (isLoginHost && oidc) {
		const realm = oidc[1].toLowerCase();
		if (realm === "volterra") return null;
		const tenant = realm.replace(/-[a-z0-9]+$/, "");
		const env: "production" | "staging" = hostname.includes("staging") ? "staging" : "production";
		return DNS_LABEL_RE.test(tenant) ? { tenant, env } : null;
	}
	return null;
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
