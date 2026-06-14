import { computeResourceDiff } from "./diff-engine";
import type {
	OperationResult,
	ResolvedKind,
	ResourceClientOptions,
	ResourceDiff,
	ResourceError,
	ResourceManifest,
} from "./types";

const F5XC_ERROR_CODES: Record<number, string> = {
	3: "INVALID_ARGUMENT",
	5: "NOT_FOUND",
	6: "ALREADY_EXISTS",
	7: "PERMISSION_DENIED",
	8: "RESOURCE_EXHAUSTED",
	9: "FAILED_PRECONDITION",
	13: "INTERNAL",
	14: "UNAVAILABLE",
	16: "UNAUTHENTICATED",
};

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([429, 503, 408]);

export class ResourceClient {
	readonly #apiUrl: string;
	readonly #apiToken: string;
	readonly #defaultNamespace: string;
	readonly #resolvePayloadVars?: (json: string) => string;

	constructor(options: ResourceClientOptions) {
		this.#apiUrl = options.apiUrl;
		this.#apiToken = options.apiToken;
		this.#defaultNamespace = options.namespace;
		this.#resolvePayloadVars = options.resolvePayloadVars;
	}

	async apply(
		manifest: ResourceManifest,
		resolved: ResolvedKind,
		namespaceOverride?: string,
		dryRun?: "client" | "server",
	): Promise<OperationResult> {
		const namespace = this.#resolveNamespace(manifest, namespaceOverride);
		const name = manifest.metadata.name;
		const getUrl = this.#buildUrl(resolved.paths.get, namespace, name);

		const startMs = performance.now();
		const existing = await this.#fetchResource(getUrl);

		if (existing.status === 404) {
			if (dryRun) return { status: "dry-run", action: "create" };
			return this.#createResource(manifest, resolved, namespace, startMs);
		}

		if (existing.error) return { status: "error", error: existing.error };

		const currentSpec = (existing.body?.spec ?? {}) as Record<string, unknown>;
		const diff = computeResourceDiff(currentSpec, manifest.spec);

		if (!diff.hasDifferences) {
			return { status: "unchanged", resource: existing.body! };
		}

		if (dryRun) return { status: "dry-run", action: "update", diff };
		return this.#updateResource(manifest, resolved, namespace, diff, startMs);
	}

	async create(
		manifest: ResourceManifest,
		resolved: ResolvedKind,
		namespaceOverride?: string,
		dryRun?: "client" | "server",
	): Promise<OperationResult> {
		if (dryRun) return { status: "dry-run", action: "create" };

		const namespace = this.#resolveNamespace(manifest, namespaceOverride);
		const startMs = performance.now();
		return this.#createResource(manifest, resolved, namespace, startMs);
	}

	async delete(
		kind: string,
		name: string,
		resolved: ResolvedKind,
		namespaceOverride?: string,
	): Promise<OperationResult> {
		const namespace = namespaceOverride ?? this.#defaultNamespace;
		const url = this.#buildUrl(resolved.paths.delete, namespace, name);

		const startMs = performance.now();
		const result = await this.#fetch(url, "DELETE");
		const durationMs = Math.round(performance.now() - startMs);

		if (result.error) return { status: "error", error: result.error };
		return { status: "deleted", name, kind, durationMs };
	}

	async get(
		resolved: ResolvedKind,
		name?: string,
		namespaceOverride?: string,
	): Promise<{ items?: Record<string, unknown>[]; resource?: Record<string, unknown>; error?: ResourceError }> {
		const namespace = namespaceOverride ?? this.#defaultNamespace;

		if (name) {
			const url = this.#buildUrl(resolved.paths.get, namespace, name);
			const result = await this.#fetchResource(url);
			if (result.error) return { error: result.error };
			return { resource: result.body! };
		}

		const url = this.#buildUrl(resolved.paths.list, namespace);
		const result = await this.#fetchResource(url);
		if (result.error) return { error: result.error };

		const body = result.body!;
		const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
		return { items };
	}

	async diff(
		manifest: ResourceManifest,
		resolved: ResolvedKind,
		namespaceOverride?: string,
	): Promise<{ diff?: ResourceDiff; isNew: boolean; error?: ResourceError }> {
		const namespace = this.#resolveNamespace(manifest, namespaceOverride);
		const name = manifest.metadata.name;
		const url = this.#buildUrl(resolved.paths.get, namespace, name);

		const existing = await this.#fetchResource(url);
		if (existing.status === 404) {
			return { isNew: true };
		}
		if (existing.error) return { isNew: false, error: existing.error };

		const currentSpec = (existing.body?.spec ?? {}) as Record<string, unknown>;
		const diffResult = computeResourceDiff(currentSpec, manifest.spec);
		return { diff: diffResult, isNew: false };
	}

	#resolveNamespace(manifest: ResourceManifest, override?: string): string {
		return override ?? manifest.metadata.namespace ?? this.#defaultNamespace;
	}

	#buildUrl(pathTemplate: string, namespace: string, name?: string): string {
		let resolved = pathTemplate.replace(/\{namespace\}/g, encodeURIComponent(namespace));
		if (name) {
			resolved = resolved.replace(/\{name\}/g, encodeURIComponent(name));
		}
		return `${this.#apiUrl}${resolved}`;
	}

	async #createResource(
		manifest: ResourceManifest,
		resolved: ResolvedKind,
		namespace: string,
		startMs: number,
	): Promise<OperationResult> {
		const url = this.#buildUrl(resolved.paths.create, namespace);
		const body = this.#buildRequestBody(manifest, namespace);
		const result = await this.#fetch(url, "POST", body);
		const durationMs = Math.round(performance.now() - startMs);

		if (result.error) {
			if (result.error.httpStatus === 409) {
				return this.#updateResource(manifest, resolved, namespace, undefined, startMs);
			}
			return { status: "error", error: result.error };
		}

		return { status: "created", resource: result.body ?? {}, durationMs };
	}

	async #updateResource(
		manifest: ResourceManifest,
		resolved: ResolvedKind,
		namespace: string,
		diff: ResourceDiff | undefined,
		startMs: number,
	): Promise<OperationResult> {
		const name = manifest.metadata.name;
		const url = this.#buildUrl(resolved.paths.update, namespace, name);
		const body = this.#buildRequestBody(manifest, namespace);
		const result = await this.#fetch(url, "PUT", body);
		const durationMs = Math.round(performance.now() - startMs);

		if (result.error) return { status: "error", error: result.error };

		const actualDiff = diff ?? {
			hasDifferences: true,
			added: [],
			removed: [],
			changed: [],
			unchangedCount: 0,
		};

		return { status: "updated", resource: result.body ?? {}, diff: actualDiff, durationMs };
	}

	#buildRequestBody(manifest: ResourceManifest, namespace: string): Record<string, unknown> {
		const { kind: _kind, ...rest } = manifest.rawObject;
		const body = { ...rest };

		if (body.metadata && typeof body.metadata === "object") {
			(body.metadata as Record<string, unknown>).namespace = namespace;
		}

		return body;
	}

	async #fetchResource(
		url: string,
	): Promise<{ status: number; body?: Record<string, unknown>; error?: ResourceError }> {
		const result = await this.#fetch(url, "GET");
		return { status: result.httpStatus, body: result.body, error: result.error };
	}

	async #fetch(
		url: string,
		method: string,
		body?: Record<string, unknown>,
	): Promise<{ httpStatus: number; body?: Record<string, unknown>; error?: ResourceError }> {
		const headers: Record<string, string> = {
			Authorization: `APIToken ${this.#apiToken}`,
			Accept: "application/json",
			"X-Request-ID": crypto.randomUUID(),
		};

		const init: RequestInit = { method, headers, signal: AbortSignal.timeout(30_000) };

		if (body && method !== "GET") {
			headers["Content-Type"] = "application/json";
			let jsonBody = JSON.stringify(body);
			if (this.#resolvePayloadVars) {
				jsonBody = this.#resolvePayloadVars(jsonBody);
			}
			init.body = jsonBody;
		}

		let lastError: ResourceError | undefined;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				const response = await fetch(url, init);

				if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
					const retryAfter = response.headers.get("retry-after");
					const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
					const delayMs =
						Number.isFinite(seconds) && seconds > 0
							? Math.min(seconds * 1000, 10_000)
							: Math.min(1000 * 2 ** attempt, 10_000);
					await Bun.sleep(delayMs);
					continue;
				}

				const raw = await response.text();
				let parsed: Record<string, unknown> | undefined;
				try {
					parsed = JSON.parse(raw) as Record<string, unknown>;
				} catch {
					// Non-JSON response
				}

				if (response.status >= 200 && response.status < 300) {
					return { httpStatus: response.status, body: parsed ?? {} };
				}

				if (response.status === 404) {
					return { httpStatus: 404, error: this.#toResourceError(response.status, parsed, url) };
				}

				return { httpStatus: response.status, error: this.#toResourceError(response.status, parsed, url) };
			} catch (err) {
				if (attempt >= MAX_RETRIES) {
					lastError = {
						kind: "network",
						message: `Network error: ${(err as Error).message}`,
					};
					break;
				}
				await Bun.sleep(Math.min(1000 * 2 ** attempt, 10_000));
			}
		}

		return { httpStatus: 0, error: lastError };
	}

	#toResourceError(status: number, body: Record<string, unknown> | undefined, _url: string): ResourceError {
		const code = body?.code as number | undefined;
		const codeLabel = code != null ? F5XC_ERROR_CODES[code] : undefined;
		const message = (body?.message as string) ?? (body?.error as string) ?? `HTTP ${status}`;
		const prefix = codeLabel ? `[${codeLabel}] ` : "";

		if (status === 401 || status === 403) {
			return {
				kind: "auth",
				message: `${prefix}${message}. Check your API token and context credentials.`,
				httpStatus: status,
			};
		}
		if (status === 404) {
			return { kind: "not_found", message: `${prefix}Resource not found.`, httpStatus: status };
		}
		if (status === 409) {
			return { kind: "conflict", message: `${prefix}${message}`, httpStatus: status };
		}

		return { kind: "api", message: `${prefix}${message}`, httpStatus: status };
	}
}
