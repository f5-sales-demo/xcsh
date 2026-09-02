import { type XCSH_API_TOKEN, XCSH_API_URL, type XCSH_CONSOLE_PASSWORD, type XCSH_USERNAME } from "./xcsh-env-names";

export type XcshCredentialKey =
	| typeof XCSH_API_URL
	| typeof XCSH_API_TOKEN
	| typeof XCSH_USERNAME
	| typeof XCSH_CONSOLE_PASSWORD;

export type XcshAuthValidationFailure =
	| "unauthorized"
	| "forbidden"
	| "redirect"
	| "non_json"
	| "rate_limited"
	| "server"
	| "timeout"
	| "network";

export type XcshAuthValidationStatus = "connected" | "auth_error" | "offline";

export interface XcshAuthValidationResult {
	status: XcshAuthValidationStatus;
	latencyMs: number;
	httpStatus?: number;
	failureReason?: XcshAuthValidationFailure;
	namespaces?: string[];
}

export interface XcshAuthValidationOptions {
	apiUrl: string;
	apiToken: string;
	fetch?: typeof globalThis.fetch;
	timeoutMs?: number;
	signal?: AbortSignal;
	now?: () => number;
}

function unwrapWholeValueQuotes(value: string): string | null {
	if (value.startsWith('"') || value.endsWith('"') || value.startsWith("'") || value.endsWith("'")) {
		if (!(value.length >= 2 && value[0] === value.at(-1))) return null;
		return value.slice(1, -1);
	}
	return value;
}

/** Normalize a raw credential or a supported shell/dotenv assignment without evaluating it. */
export function normalizeXcshCredentialInput(value: string, expectedKey: XcshCredentialKey): string | null {
	if (typeof value !== "string" || /\r|\n/.test(value)) return null;
	const trimmed = value.trim();
	if (!trimmed) return "";

	const assignment = trimmed.match(/^(?:#\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
	const isShellAssignment =
		assignment !== null &&
		(assignment[1] === expectedKey || assignment[1].startsWith("XCSH_") || /^(?:#\s*)?(?:export\s+)/.test(trimmed));
	if (assignment && isShellAssignment) {
		if (assignment[1] !== expectedKey) return null;
		return unwrapWholeValueQuotes(assignment[2].trim());
	}

	if (trimmed === expectedKey || trimmed === `export ${expectedKey}` || trimmed === `#${expectedKey}`) return null;
	if (/^(?:#\s*)?(?:export\s+)?XCSH_[A-Za-z0-9_]*\s*=/.test(trimmed)) return null;
	return unwrapWholeValueQuotes(trimmed);
}

/** Normalize a parseable absolute API URL to its origin. */
export function normalizeXcshApiUrlInput(value: string): string | null {
	const normalized = normalizeXcshCredentialInput(value, XCSH_API_URL);
	if (normalized === null || normalized === "") return null;
	try {
		return new URL(normalized).origin;
	} catch {
		return null;
	}
}

export function buildXcshAuthHeaders(apiToken: string): Record<string, string> {
	return { Authorization: `APIToken ${apiToken}`, Accept: "application/json" };
}

function extractNamespaceNames(payload: unknown): string[] {
	let values: unknown[] = [];
	if (Array.isArray(payload)) values = payload;
	else if (payload && typeof payload === "object") {
		const record = payload as Record<string, unknown>;
		if (Array.isArray(record.items)) values = record.items;
		else if (Array.isArray(record.namespaces)) values = record.namespaces;
	}
	return [
		...new Set(
			values
				.map(value =>
					typeof value === "string"
						? value
						: value && typeof value === "object" && typeof (value as Record<string, unknown>).name === "string"
							? ((value as Record<string, unknown>).name as string)
							: null,
				)
				.filter((value): value is string => value !== null && value.length > 0),
		),
	].sort((a, b) => a.localeCompare(b));
}

/** Validate API credentials without leaking credentials, response bodies, or tenant URLs in the result. */
export async function validateXcshApiCredentials(
	options: XcshAuthValidationOptions,
): Promise<XcshAuthValidationResult> {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? 3000;
	const now = options.now ?? (() => performance.now());
	const startedAt = now();
	const controller = new AbortController();
	const abort = (): void => controller.abort();
	const timer = setTimeout(abort, timeoutMs);
	const externalAbort = (): void => controller.abort();
	options.signal?.addEventListener("abort", externalAbort, { once: true });
	if (options.signal?.aborted) controller.abort();
	const latency = (): number => Math.max(0, Math.round(now() - startedAt));

	try {
		const apiUrl = normalizeXcshApiUrlInput(options.apiUrl) ?? options.apiUrl.trim().replace(/\/+$/, "");
		const response = await fetchImpl(`${apiUrl}/api/web/namespaces`, {
			method: "GET",
			headers: buildXcshAuthHeaders(options.apiToken),
			signal: controller.signal,
			redirect: "manual",
		});
		const base = { latencyMs: latency(), ...(response.status ? { httpStatus: response.status } : {}) };
		if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
			return { status: "offline", ...base, failureReason: "redirect" };
		}
		if (response.status === 401 || response.status === 403) {
			return {
				status: "auth_error",
				...base,
				failureReason: response.status === 401 ? "unauthorized" : "forbidden",
			};
		}
		if (response.status === 429) return { status: "offline", ...base, failureReason: "rate_limited" };
		if (response.status >= 500) return { status: "offline", ...base, failureReason: "server" };
		if (!response.ok) return { status: "offline", ...base, failureReason: "network" };

		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.toLowerCase().includes("application/json")) {
			return { status: "offline", ...base, failureReason: "non_json" };
		}
		try {
			const payload = await response.json();
			return { status: "connected", ...base, namespaces: extractNamespaceNames(payload) };
		} catch {
			return { status: "offline", ...base, failureReason: "non_json" };
		}
	} catch (error) {
		const isTimeout =
			controller.signal.aborted && !options.signal?.aborted
				? true
				: error instanceof Error &&
					(error.name === "TimeoutError" || error.name === "AbortError") &&
					!options.signal?.aborted;
		return { status: "offline", latencyMs: latency(), failureReason: isTimeout ? "timeout" : "network" };
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", externalAbort);
	}
}
