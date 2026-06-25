/**
 * Canonical F5 XC context environment-variable names and the secret-detection
 * rule, shared by every host (the xcsh shell and the VS Code extension) so both
 * agree on which keys are reserved, which are recognized auth credentials, and
 * which values must be masked.
 *
 * This module is intentionally dependency-free (no Bun/Node APIs) so a CommonJS
 * `require()` from the extension can load it without dragging in the Bun-only
 * barrel. Names are typed `as const` so bracket access like
 * `process.env[XCSH_API_URL]` type-checks correctly.
 */

export const XCSH_API_URL = "XCSH_API_URL" as const;
export const XCSH_API_TOKEN = "XCSH_API_TOKEN" as const;
export const XCSH_NAMESPACE = "XCSH_NAMESPACE" as const;
export const XCSH_TENANT = "XCSH_TENANT" as const;
export const XCSH_USERNAME = "XCSH_USERNAME" as const;
export const XCSH_CONSOLE_PASSWORD = "XCSH_CONSOLE_PASSWORD" as const;
/** Active context profile name. Read-only metadata injected by ContextService. */
export const XCSH_CONTEXT_NAME = "XCSH_CONTEXT_NAME" as const;

/**
 * Control env vars owned by the context itself (apiUrl/apiToken/defaultNamespace
 * → XCSH_API_URL/XCSH_API_TOKEN/XCSH_NAMESPACE), derived (XCSH_TENANT), or
 * injected at activation (XCSH_CONTEXT_NAME). A context's custom `env` map must
 * never set these — they would be ignored or clobbered by the resolver.
 */
export const RESERVED_ENV_KEYS: ReadonlySet<string> = new Set([
	XCSH_NAMESPACE,
	XCSH_API_URL,
	XCSH_API_TOKEN,
	XCSH_TENANT,
	XCSH_CONTEXT_NAME,
]);

/**
 * Recognized web-console login credentials. Unlike RESERVED_ENV_KEYS these live
 * in the context's generic `env` map (a user sets them like any other variable),
 * but hosts surface them in a dedicated "Auth" section, in display order.
 */
export const AUTH_ENV_KEYS: readonly string[] = [XCSH_USERNAME, XCSH_CONSOLE_PASSWORD];

/** Env var name patterns that indicate a secret value (mask in output, redact on export). */
export const SECRET_ENV_PATTERNS = /(?:KEY|SECRET|TOKEN|PASSWORD|PASS|AUTH|CREDENTIAL|PRIVATE|OAUTH)(?:_|$)/i;

/** True iff an env var NAME looks like it holds a secret (e.g. XCSH_CONSOLE_PASSWORD). */
export function isSensitiveEnvKey(key: string): boolean {
	return SECRET_ENV_PATTERNS.test(key);
}
