/**
 * Idempotency for create automations. Creating an object that already exists
 * produces an error on the F5 console (and the API). To make create workflows
 * idempotent, the runner does a PRE-FLIGHT existence check and decides what to
 * do based on the configured mode:
 *
 *   - "skip"     (default): if it already exists, skip the form and report success
 *                — re-running the automation is a no-op, the desired state holds.
 *   - "recreate":          delete the existing object first, then run the form
 *                — guarantees a fresh create (used by the sweep harness).
 *   - "error":             run the form anyway (legacy — will hit the console's
 *                "object already exists" error; surfaced, not swallowed).
 *
 * Plus a post-save detector: if a save DID hit an already-exists error, that's
 * idempotently fine — the object is present, which is the desired state.
 */
export type IdempotencyMode = "skip" | "recreate" | "error";

export type PreflightAction = "proceed" | "skip" | "delete-first";

/** Decide the pre-flight action from whether the object exists + the mode. */
export function resolvePreflightAction(exists: boolean, mode: IdempotencyMode): PreflightAction {
	if (!exists) return "proceed";
	switch (mode) {
		case "skip":
			return "skip";
		case "recreate":
			return "delete-first";
		case "error":
			return "proceed";
	}
}

/** True when an error/banner text indicates the object already exists. */
export function isAlreadyExistsError(text: string | null | undefined): boolean {
	if (!text) return false;
	return /already\s+exists|duplicate\s+(key|entry|object)|object.*exists|409|conflict/i.test(text);
}

/**
 * Guard the API token against SSRF/credential-leakage. The token is sent in the
 * Authorization header of API calls keyed on `baseUrl` — and baseUrl can be
 * caller-supplied. Only allow the credential to leave for a trusted host:
 *   - must be a well-formed https:// URL (no http, no file, no other scheme),
 *   - host must not be loopback / RFC-1918 / link-local,
 *   - when `expectedUrl` is set, the host must match it exactly.
 * Returns true only when it is safe to send the credential to baseUrl.
 */
export function isTrustedApiUrl(baseUrl: string, expectedUrl?: string | undefined): boolean {
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		return false;
	}
	if (parsed.protocol !== "https:") return false;
	const host = parsed.hostname.toLowerCase();
	// Block loopback / private / link-local literals (SSRF to internal services).
	if (
		host === "localhost" ||
		host === "0.0.0.0" ||
		/^127\./.test(host) ||
		/^10\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
		/^169\.254\./.test(host) ||
		host === "[::1]" ||
		host.startsWith("[fe80:") ||
		host.startsWith("[fc") ||
		host.startsWith("[fd")
	) {
		return false;
	}
	// When an expected host is configured, require an exact match.
	if (expectedUrl) {
		try {
			if (host !== new URL(expectedUrl).hostname.toLowerCase()) return false;
		} catch {
			return false;
		}
	}
	return true;
}
