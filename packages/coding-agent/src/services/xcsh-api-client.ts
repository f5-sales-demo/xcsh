import { logger } from "@f5-sales-demo/pi-utils";

export type ApiErrorKind = "auth" | "network" | "server";

export class XCSHApiError extends Error {
	constructor(
		message: string,
		readonly kind: ApiErrorKind,
		readonly status?: number,
	) {
		super(message);
		this.name = "XCSHApiError";
	}
}

/** The fetch call signature the client depends on (a structural subset of `typeof fetch`). */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface XCSHNamespace {
	name: string;
}

export interface XCSHNamespaceStatus {
	name: string;
	phase: string;
}

export interface XCSHObject {
	name: string;
	namespace: string;
	kind: string;
}

export interface XCSHApiClientOptions {
	apiUrl: string;
	apiToken: string;
	timeoutMs?: number;
	maxRetries?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	/**
	 * Optional fetch implementation. When provided, the client uses exactly this
	 * function and never reads `globalThis.fetch` — which keeps tests hermetic:
	 * another concurrently-running test file (`bun test --max-concurrency`) can
	 * reassign `globalThis.fetch` mid-request without corrupting this client.
	 * When omitted, the client defers to `globalThis.fetch` dynamically at call
	 * time (preserving the default production/integration behavior).
	 */
	fetch?: FetchFn;
}

export class XCSHApiClient {
	#apiUrl: string;
	#apiToken: string;
	#timeoutMs: number;
	#maxRetries: number;
	#baseDelayMs: number;
	#maxDelayMs: number;
	#fetch: FetchFn;

	constructor(opts: XCSHApiClientOptions) {
		this.#apiUrl = opts.apiUrl.replace(/\/+$/, "");
		this.#apiToken = opts.apiToken;
		this.#timeoutMs = opts.timeoutMs ?? 10_000;
		this.#maxRetries = opts.maxRetries ?? 3;
		this.#baseDelayMs = opts.baseDelayMs ?? 500;
		this.#maxDelayMs = opts.maxDelayMs ?? 10_000;
		this.#fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
	}

	#isRetryable(status: number): boolean {
		return status >= 500 || status === 429 || status === 408;
	}

	async #fetchWithRetry(path: string): Promise<Response> {
		const url = `${this.#apiUrl}${path}`;
		const headers = {
			Authorization: `APIToken ${this.#apiToken}`,
			Accept: "application/json",
		};
		const maxAttempts = this.#maxRetries + 1;
		let lastStatus: number | undefined;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			let response: Response;
			try {
				const start = performance.now();
				response = await this.#fetch(url, {
					method: "GET",
					headers,
					signal: AbortSignal.timeout(this.#timeoutMs),
				});
				const latencyMs = Math.round(performance.now() - start);
				logger.debug("XCSH API response", { path, status: response.status, latencyMs });
			} catch (err) {
				if (attempt < this.#maxRetries) {
					const delayMs = this.#backoffDelay(attempt);
					logger.debug("XCSH API retry (network)", {
						path,
						attempt: attempt + 1,
						maxRetries: this.#maxRetries,
						delayMs,
					});
					await this.#sleep(delayMs);
					continue;
				}
				throw new XCSHApiError(
					`Network error requesting ${path}: ${err instanceof Error ? err.message : String(err)}`,
					"network",
				);
			}

			if (response.status === 401 || response.status === 403) {
				throw new XCSHApiError(
					`Authentication failed for ${path} (HTTP ${response.status})`,
					"auth",
					response.status,
				);
			}

			if (response.ok) {
				return response;
			}

			lastStatus = response.status;

			if (this.#isRetryable(response.status)) {
				if (attempt < this.#maxRetries) {
					let delayMs: number;
					if (response.status === 429) {
						const retryAfter = response.headers.get("Retry-After");
						const retrySeconds = retryAfter ? Number(retryAfter) : NaN;
						delayMs = Number.isFinite(retrySeconds)
							? Math.min(retrySeconds * 1000, this.#maxDelayMs)
							: this.#backoffDelay(attempt);
					} else {
						delayMs = this.#backoffDelay(attempt);
					}
					logger.debug("XCSH API retry", {
						path,
						attempt: attempt + 1,
						maxRetries: this.#maxRetries,
						status: response.status,
						delayMs,
					});
					await this.#sleep(delayMs);
					continue;
				}
			}

			throw new XCSHApiError(`Request failed for ${path} (HTTP ${response.status})`, "server", response.status);
		}

		throw new XCSHApiError(
			`Request failed for ${path} after ${maxAttempts} attempts (HTTP ${lastStatus})`,
			"server",
			lastStatus,
		);
	}

	#backoffDelay(attempt: number): number {
		const base = this.#baseDelayMs * 2 ** attempt;
		const capped = Math.min(base, this.#maxDelayMs);
		const jitter = capped * Math.random() * 0.25;
		return Math.round(Math.min(capped + jitter, this.#maxDelayMs));
	}

	#sleep(ms: number): Promise<void> {
		return Bun.sleep(ms);
	}

	#parseItems<T>(body: unknown, extract: (item: unknown) => T | null): T[] {
		if (typeof body !== "object" || body === null) return [];
		const envelope = body as Record<string, unknown>;
		const items = envelope.items;
		if (!Array.isArray(items)) return [];
		const results: T[] = [];
		for (const item of items) {
			const extracted = extract(item);
			if (extracted !== null) results.push(extracted);
		}
		return results;
	}

	async listNamespaces(): Promise<XCSHNamespace[]> {
		const response = await this.#fetchWithRetry("/api/web/namespaces");
		const body: unknown = await response.json();
		return this.#parseItems(body, (item): XCSHNamespace | null => {
			if (typeof item !== "object" || item === null) return null;
			const record = item as Record<string, unknown>;
			if (typeof record.name !== "string") return null;
			return { name: record.name };
		});
	}

	async getNamespaceStatus(ns: string): Promise<XCSHNamespaceStatus> {
		const response = await this.#fetchWithRetry(`/api/web/namespaces/${encodeURIComponent(ns)}/status`);
		const body: unknown = await response.json();
		if (typeof body !== "object" || body === null) {
			throw new XCSHApiError("Invalid response for namespace status: expected object", "server");
		}
		const record = body as Record<string, unknown>;
		if (typeof record.name !== "string" || typeof record.phase !== "string") {
			throw new XCSHApiError(
				"Invalid response for namespace status: missing required fields (name, phase)",
				"server",
			);
		}
		return { name: record.name, phase: record.phase };
	}

	async listObjects(ns: string, kind: string): Promise<XCSHObject[]> {
		const response = await this.#fetchWithRetry(
			`/api/web/namespaces/${encodeURIComponent(ns)}/${encodeURIComponent(kind)}`,
		);
		const body: unknown = await response.json();
		return this.#parseItems(body, (item): XCSHObject | null => {
			if (typeof item !== "object" || item === null) return null;
			const record = item as Record<string, unknown>;
			if (
				typeof record.name !== "string" ||
				typeof record.namespace !== "string" ||
				typeof record.kind !== "string"
			) {
				return null;
			}
			return { name: record.name, namespace: record.namespace, kind: record.kind };
		});
	}
}
