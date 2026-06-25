import { computeResourceDiff } from "./diff-engine";
import type { ExportedManifest } from "./manifest-export";
import { toManifest, toManifestList } from "./manifest-export";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

import type {
	HttpTransport,
	HttpTransportRequest,
	HttpTransportResponse,
	KindResolver,
	OperationResult,
	ResolvedKind,
	ResourceClientOptions,
	ResourceDiff,
	ResourceError,
	ResourceManifest,
} from "./types";

export class FetchTransport implements HttpTransport {
	readonly #apiToken: string;

	constructor(apiToken: string) {
		this.#apiToken = apiToken;
	}

	async request(req: HttpTransportRequest): Promise<HttpTransportResponse> {
		const headers: Record<string, string> = {
			Authorization: `APIToken ${this.#apiToken}`,
			Accept: "application/json",
			"X-Request-ID": crypto.randomUUID(),
			...req.headers,
		};

		let resolvedBody: string | undefined;
		if (req.body && req.method !== "GET") {
			headers["Content-Type"] = "application/json";
			resolvedBody = JSON.stringify(req.body);
		}

		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				const init: RequestInit = {
					method: req.method,
					headers,
					signal: AbortSignal.timeout(30_000),
					body: resolvedBody,
				};
				const response = await fetch(req.url, init);

				if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
					const retryAfter = response.headers.get("retry-after");
					const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
					const delayMs =
						Number.isFinite(seconds) && seconds > 0
							? Math.min(seconds * 1000, 10_000)
							: Math.min(1000 * 2 ** attempt, 10_000);
					await sleep(delayMs);
					continue;
				}

				const raw = await response.text();
				let parsed: Record<string, unknown> | undefined;
				try {
					parsed = JSON.parse(raw) as Record<string, unknown>;
				} catch {
					// Non-JSON response
				}

				return { httpStatus: response.status, body: parsed ?? {} };
			} catch (err) {
				lastError = err as Error;
				if (attempt >= MAX_RETRIES) break;
				await sleep(Math.min(1000 * 2 ** attempt, 10_000));
			}
		}

		throw lastError ?? new Error("Request failed after retries");
	}
}

const XCSH_ERROR_CODES: Record<number, string> = {
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
	readonly #defaultNamespace: string;
	readonly #resolvePayloadVars?: (json: string) => string;
	readonly #transport: HttpTransport;

	constructor(options: ResourceClientOptions) {
		// Strip trailing slash(es) so `#buildUrl`'s `${apiUrl}${path}` concat (path
		// templates begin with `/api/...`) cannot emit `//`, which a consumer's
		// `new URL()` would parse as a protocol-relative authority and collapse the
		// request host to a bare label.
		this.#apiUrl = options.apiUrl.replace(/\/+$/, "");
		this.#defaultNamespace = options.namespace;
		this.#resolvePayloadVars = options.resolvePayloadVars;
		this.#transport = options.transport ?? new FetchTransport(options.apiToken);
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

		const diff = this.#computeManifestDiff(existing.body!, manifest);

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

	async exportOne(
		kind: string,
		resolved: ResolvedKind,
		name: string,
		namespaceOverride?: string,
	): Promise<{ manifest?: ExportedManifest; error?: ResourceError }> {
		const namespace = namespaceOverride ?? this.#defaultNamespace;
		const url = this.#buildUrl(resolved.paths.get, namespace, name);
		const result = await this.#fetchResource(url);
		if (result.error) return { error: result.error };
		return { manifest: toManifest(result.body!, kind) };
	}

	async exportAll(
		kindResolver: KindResolver,
		namespaceOverride?: string,
		onProgress?: (kind: string, count: number) => void,
	): Promise<{ manifests: ExportedManifest[]; errors: Array<{ kind: string; error: ResourceError }> }> {
		const namespace = namespaceOverride ?? this.#defaultNamespace;
		const kinds = kindResolver.getKindsWithApiPaths();
		const manifests: ExportedManifest[] = [];
		const errors: Array<{ kind: string; error: ResourceError }> = [];

		for (const kind of kinds) {
			try {
				const resolved = kindResolver.resolveKind(kind);
				const url = this.#buildUrl(resolved.paths.list, namespace);
				const result = await this.#fetchResource(url);

				if (result.error) {
					errors.push({ kind, error: result.error });
					continue;
				}

				const exported = toManifestList(result.body!, kind);
				if (exported.length > 0) {
					manifests.push(...exported);
					onProgress?.(kind, exported.length);
				}
			} catch {
				errors.push({ kind, error: { kind: "api", message: `Failed to export ${kind}` } });
			}
		}

		return { manifests, errors };
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

		const diff = this.#computeManifestDiff(existing.body!, manifest);
		return { diff, isNew: false };
	}

	#computeManifestDiff(serverResource: Record<string, unknown>, manifest: ResourceManifest): ResourceDiff {
		const currentSpec = (serverResource.spec ?? {}) as Record<string, unknown>;
		const filteredSpec = filterToManifestKeys(currentSpec, manifest.spec) as Record<string, unknown>;
		const specDiff = computeResourceDiff(filteredSpec, manifest.spec);

		const currentMeta = (serverResource.metadata ?? {}) as Record<string, unknown>;
		const desiredMeta = manifest.rawObject.metadata as Record<string, unknown>;
		const metaDiff = computeResourceDiff(
			filterToManifestKeys(currentMeta, desiredMeta) as Record<string, unknown>,
			desiredMeta,
		);

		return {
			hasDifferences: specDiff.hasDifferences || metaDiff.hasDifferences,
			added: [...specDiff.added, ...metaDiff.added],
			removed: [...specDiff.removed, ...metaDiff.removed],
			changed: [...specDiff.changed, ...metaDiff.changed],
			unchangedCount: specDiff.unchangedCount + metaDiff.unchangedCount,
		};
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
		const body = {
			...rest,
			metadata: { ...(rest.metadata as Record<string, unknown>), namespace },
		};
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
		let resolvedBody = body;
		if (body && this.#resolvePayloadVars) {
			const jsonBody = this.#resolvePayloadVars(JSON.stringify(body));
			resolvedBody = JSON.parse(jsonBody) as Record<string, unknown>;
		}

		try {
			const result = await this.#transport.request({
				method: method as "GET" | "POST" | "PUT" | "DELETE",
				url,
				body: resolvedBody,
			});

			if (result.httpStatus >= 200 && result.httpStatus < 300) {
				return { httpStatus: result.httpStatus, body: result.body ?? {} };
			}

			return {
				httpStatus: result.httpStatus,
				error: this.#toResourceError(result.httpStatus, result.body, url),
			};
		} catch (err) {
			return {
				httpStatus: 0,
				error: { kind: "network", message: `Network error: ${(err as Error).message}` },
			};
		}
	}

	#toResourceError(status: number, body: Record<string, unknown> | undefined, _url: string): ResourceError {
		const code = body?.code as number | undefined;
		const codeLabel = code != null ? XCSH_ERROR_CODES[code] : undefined;
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

function filterToManifestKeys(serverVal: unknown, manifestVal: unknown): unknown {
	if (manifestVal === null || manifestVal === undefined) return manifestVal;
	if (serverVal === null || serverVal === undefined) return serverVal;
	if (typeof manifestVal !== "object" || typeof serverVal !== "object") return serverVal;

	if (Array.isArray(manifestVal) && Array.isArray(serverVal)) {
		return serverVal.map((item, i) => (i < manifestVal.length ? filterToManifestKeys(item, manifestVal[i]) : item));
	}

	if (Array.isArray(manifestVal) || Array.isArray(serverVal)) return serverVal;

	const mObj = manifestVal as Record<string, unknown>;
	const sObj = serverVal as Record<string, unknown>;
	const mKeys = Object.keys(mObj);
	if (mKeys.length === 0) return {};
	const filtered: Record<string, unknown> = {};
	for (const key of mKeys) {
		if (key in sObj) {
			filtered[key] = filterToManifestKeys(sObj[key], mObj[key]);
		}
	}
	return filtered;
}
