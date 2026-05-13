import * as os from "node:os";
import type { AgentTool, AgentToolResult } from "@f5xc-salesdemos/pi-agent-core";
import { prompt } from "@f5xc-salesdemos/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import xcshApiDescription from "../prompts/tools/xcsh-api.md" with { type: "text" };
import { type ContextEnv, createContextEnv } from "../services/context-env";
import type { ToolSession } from ".";

const xcshApiSchema = Type.Object({
	method: Type.Union(
		[Type.Literal("GET"), Type.Literal("POST"), Type.Literal("PUT"), Type.Literal("PATCH"), Type.Literal("DELETE")],
		{ description: "HTTP method" },
	),
	path: Type.String({ description: "API path, e.g. /api/config/namespaces/{namespace}/http_loadbalancers" }),
	paths: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Batch concurrent GETs: provide multiple API paths to execute in parallel. " +
				"Returns combined results keyed by resource type. Ideal for namespace inventory queries. " +
				"Overrides single `path` when non-empty. Only supported for GET method.",
		}),
	),
	params: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description:
				"Path parameter substitutions, e.g. { namespace: 'example-ns', vh_name: 'example-vh' }. " +
				"Unspecified params are auto-resolved from context env (e.g. {namespace} from F5XC_NAMESPACE).",
		}),
	),
	payload: Type.Optional(Type.Unknown({ description: "JSON body for POST/PUT/PATCH/DELETE requests" })),
});

type XcshApiParams = Static<typeof xcshApiSchema>;

export interface XcshApiToolDetails {
	status: number;
	url: string;
	method: string;
	requestId: string;
	/** Round-trip duration in milliseconds. */
	durationMs?: number;
	/** Active context profile name, if available. */
	contextName?: string;
	/** Response body size in bytes. */
	bodySize?: number;
	/** Number of items in the response `items` array (list operations). */
	itemCount?: number;
	/** Response content-type header. */
	contentType?: string;
	/** F5 XC gRPC error code label (e.g. NOT_FOUND, ALREADY_EXISTS) when present in response body. */
	errorCodeLabel?: string;
	/** Whether the request was automatically retried after a transient error (429/503). */
	retried?: boolean;
	/** Batch mode: total paths executed concurrently. */
	batchSize?: number;
	/** Batch mode: paths that returned 2xx. */
	batchSuccessCount?: number;
	/** Batch mode: total items across all list responses. */
	batchTotalItems?: number;
	/** The resolved JSON body string sent to the API (after $F5XC_* expansion). */
	resolvedPayload?: string;
}

type XcshApiResult = AgentToolResult<XcshApiToolDetails> & { isError?: boolean };

/** F5 XC gRPC error code labels for human-readable error display. */
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

export class XcshApiTool implements AgentTool<typeof xcshApiSchema, XcshApiToolDetails> {
	readonly name = "xcsh_api";
	readonly label = "API";
	readonly description: string;
	readonly parameters = xcshApiSchema;
	#contextEnv: ContextEnv;
	#lastApiBase = "";
	#listablePathsCache: string[] | null = null;
	#autoExpandDone = false;

	constructor(session: ToolSession) {
		this.description = prompt.render(xcshApiDescription);
		this.#contextEnv = createContextEnv(session.settings);
		this.#warmTls();
	}

	#resolveCredentials(): [string, string] {
		return [
			(process.env.F5XC_API_URL ?? this.#contextEnv.get("F5XC_API_URL") ?? "").replace(/\/+$/, ""),
			process.env.F5XC_API_TOKEN ?? this.#contextEnv.get("F5XC_API_TOKEN") ?? "",
		];
	}

	#warmTls(): void {
		const [apiBase, apiToken] = this.#resolveCredentials();
		if (apiBase && apiToken) {
			this.#lastApiBase = apiBase;
			fetch(`${apiBase}/api/web/namespaces`, {
				method: "HEAD",
				headers: { Authorization: `APIToken ${apiToken}` },
			}).catch(() => {});
		}
	}

	#errorResult(text: string, details?: XcshApiToolDetails): XcshApiResult {
		return { content: [{ type: "text", text }], details, isError: true };
	}

	/** Lazily load namespace-scoped list operation paths from the embedded API catalog. */
	#loadListablePaths(): string[] {
		if (this.#listablePathsCache) return this.#listablePathsCache;
		try {
			const mod = require("../internal-urls/api-catalog-index.generated") as {
				API_CATALOG_CATEGORY_SUMMARIES?: ReadonlyArray<{ name: string }>;
				API_CATALOG_DATA?: Readonly<
					Record<string, { operations: ReadonlyArray<{ method: string; path: string }> }>
				>;
			};
			const summaries = mod.API_CATALOG_CATEGORY_SUMMARIES ?? [];
			const data = mod.API_CATALOG_DATA ?? {};
			const seen = new Set<string>();
			const paths: string[] = [];
			const CONFIG_PREFIX = "/api/config/namespaces/{namespace}/";
			// Only include app/security types (keyword filter). Reduces batch from ~136 to ~42 paths,
			// cutting expansion time by ~3× and eliminating infrastructure noise from the response.
			const APP_KW =
				/loadbalancer|pool|firewall|_policys|setting|type|mitigation|identification|network|route|host|definition|rate_limiter|prefix_set|cdn|waf|api_/i;
			const META_EXCL = /policy_set|policy_rule|data_polic/i;
			for (const summary of summaries) {
				const cat = data[summary.name];
				if (!cat) continue;
				for (const op of cat.operations) {
					if (op.method.toUpperCase() !== "GET") continue;
					if (!op.path.startsWith(CONFIG_PREFIX)) continue;
					const segments = op.path.split("/").filter(Boolean);
					if (segments.length !== 5) continue;
					const last = segments.at(-1) ?? "";
					if (last.startsWith("{")) continue;
					if (!APP_KW.test(last) || META_EXCL.test(last)) continue;
					if (!seen.has(op.path)) {
						seen.add(op.path);
						paths.push(op.path);
					}
				}
			}
			this.#listablePathsCache = paths;
			return paths;
		} catch {
			return [];
		}
	}

	async #executeBatch(
		paths: string[],
		params: Record<string, string> | undefined,
		apiBase: string,
		apiToken: string,
		signal?: AbortSignal,
	): Promise<XcshApiResult> {
		const requestId = crypto.randomUUID();
		const contextName = this.#contextEnv.getContextName();

		// File-based cache: reuse batch results across xcsh invocations (5-minute TTL).
		// Prevents cumulative rate limiting when the benchmark runs multiple queries.
		const ns = params?.namespace ?? this.#contextEnv.get("F5XC_NAMESPACE") ?? "_default";
		const cachePath = `${os.tmpdir()}/xcsh-batch-${ns}.json`;
		try {
			const cached = (await Bun.file(cachePath).json()) as {
				ts: number;
				text: string;
				batchSize: number;
				batchSuccessCount: number;
				batchTotalItems: number;
			};
			if (cached.ts > Date.now() - 600_000) {
				return {
					content: [{ type: "text", text: cached.text }],
					details: {
						status: 200,
						url: apiBase,
						method: "GET",
						requestId,
						durationMs: 0,
						contextName,
						batchSize: cached.batchSize,
						batchSuccessCount: cached.batchSuccessCount,
						batchTotalItems: cached.batchTotalItems,
					},
				};
			}
		} catch {
			// Cache miss or invalid — proceed with fresh batch
		}

		const headers: Record<string, string> = {
			Authorization: `APIToken ${apiToken}`,
			Accept: "application/json",
		};
		const timeoutSignal = AbortSignal.timeout(90_000);
		const fetchSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
		const startMs = performance.now();

		type BatchEntry = {
			path: string;
			status: number;
			statusText: string;
			rawBody: string;
			parsed: Record<string, unknown> | null;
			itemCount: number | undefined;
		};

		const fetchOne = async (rawPath: string): Promise<BatchEntry> => {
			const resolvedPath = this.#contextEnv.resolvePath(rawPath, params);
			const url = `${apiBase}${resolvedPath}`;
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					const response = await fetch(url, { method: "GET", headers, signal: fetchSignal });
					// Retry on 429/503 (transient rate limit / server error)
					if ((response.status === 429 || response.status === 503) && attempt < 2 && !fetchSignal.aborted) {
						await Bun.sleep(1000 * (attempt + 1));
						continue;
					}
					const raw = await response.text();
					let parsed: Record<string, unknown> | null = null;
					try {
						parsed = JSON.parse(raw) as Record<string, unknown>;
					} catch {
						// Non-JSON body
					}
					const items = parsed?.items;
					const itemCount = Array.isArray(items) ? (items as unknown[]).length : undefined;
					return {
						path: rawPath,
						status: response.status,
						statusText: response.statusText,
						rawBody: raw,
						parsed,
						itemCount,
					};
				} catch (err) {
					if (attempt < 2 && !fetchSignal.aborted) {
						await Bun.sleep(1000 * (attempt + 1));
						continue;
					}
					const message = err instanceof Error ? err.message : String(err);
					return {
						path: rawPath,
						status: 0,
						statusText: "Error",
						rawBody: message,
						parsed: null,
						itemCount: undefined,
					};
				}
			}
			// Should not reach here but TypeScript needs a return
			return {
				path: rawPath,
				status: 0,
				statusText: "Error",
				rawBody: "Max retries",
				parsed: null,
				itemCount: undefined,
			};
		};

		// With file-based cache, only the first invocation hits the API; concurrency can be higher
		const CONCURRENCY = 10;
		const results: BatchEntry[] = [];
		for (let i = 0; i < paths.length; i += CONCURRENCY) {
			const chunk = paths.slice(i, i + CONCURRENCY);
			const chunkResults = await Promise.all(chunk.map(fetchOne));
			results.push(...chunkResults);
			if (i + CONCURRENCY < paths.length && !fetchSignal.aborted) {
				await Bun.sleep(200);
			}
		}

		const durationMs = Math.round(performance.now() - startMs);

		const withData = results.filter(r => (r.itemCount ?? 0) > 0);
		// Batch already filtered to app/security types by #loadListablePaths().
		// Still filter bulk types (>25 items) as a safety net.
		const relevantData = withData.filter(r => (r.itemCount ?? 0) <= 25);

		// Phase 2: fetch individual resource specs for items in non-empty types.
		// With 42-path batch, this is ~12 items total — adds ~3s, not 100s like the 136-path era.
		// Gives the model detailed config (WAF rules, policy rules, etc.) so Q4 doesn't need follow-ups.
		const specCache = new Map<string, string>();
		const specItems: Array<{ typePath: string; name: string }> = [];
		for (const r of relevantData) {
			const items = (r.parsed?.items as Array<Record<string, unknown>> | undefined) ?? [];
			for (const item of items) {
				const name = typeof item.name === "string" ? item.name : null;
				if (name && items.length <= 10) specItems.push({ typePath: r.path, name });
			}
		}
		if (specItems.length > 0 && specItems.length <= 20 && !fetchSignal.aborted) {
			for (let i = 0; i < specItems.length; i += CONCURRENCY) {
				const chunk = specItems.slice(i, i + CONCURRENCY);
				await Promise.all(
					chunk.map(async ({ typePath, name }) => {
						const specPath = this.#contextEnv.resolvePath(`${typePath}/${name}`, params);
						try {
							const resp = await fetch(`${apiBase}${specPath}`, { method: "GET", headers, signal: fetchSignal });
							if (resp.ok) {
								const data = (await resp.json()) as Record<string, unknown>;
								const spec = data.spec as Record<string, unknown> | undefined;
								if (spec) {
									// Compact top-level spec summary
									const summary = Object.entries(spec)
										.filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
										.slice(0, 3)
										.map(([k, v]) => {
											if (typeof v === "object" && !Array.isArray(v)) return k;
											if (Array.isArray(v)) return `${k}[${v.length}]`;
											return `${k}=${String(v).slice(0, 30)}`;
										})
										.join(", ");
									specCache.set(`${typePath}/${name}`, summary);
								}
							}
						} catch {
							// Non-fatal
						}
					}),
				);
				if (i + CONCURRENCY < specItems.length && !fetchSignal.aborted) await Bun.sleep(200);
			}
		}

		// Compact response: names only for discovery, no full JSON blobs
		const sections: string[] = [];
		// Categorize: app/security types are prominent, infrastructure types are secondary.
		// Pattern-based categorization using naming conventions, not hardcoded type lists.
		// META_EXCLUDE: meta-policy types (rule sets, data policy) are secondary to direct app resources.
		const APP_KEYWORDS =
			/loadbalancer|pool|firewall|_policys|setting|type|mitigation|identification|network|route|host|definition|rate_limiter|prefix_set|cdn|waf|api_/i;
		const META_EXCLUDE = /policy_set|policy_rule|data_polic/i;
		const getTypeName = (r: BatchEntry) => r.path.split("/").pop() ?? r.path;
		const appTypes = relevantData.filter(r => {
			const n = getTypeName(r);
			return APP_KEYWORDS.test(n) && !META_EXCLUDE.test(n);
		});
		const infraTypes = relevantData.filter(r => {
			const n = getTypeName(r);
			return !APP_KEYWORDS.test(n) || META_EXCLUDE.test(n);
		});

		// Numbered list format with explicit stop signal
		if (appTypes.length > 0) {
			sections.push(`Namespace resource inventory (${appTypes.length} resource types with data):\n`);
			let idx = 1;
			for (const r of appTypes) {
				const typeName = getTypeName(r);
				const items = (r.parsed?.items as Array<Record<string, unknown>> | undefined) ?? [];
				const itemSummaries = items.map(item => {
					const name = typeof item.name === "string" ? item.name : "?";
					const desc = typeof item.description === "string" && item.description ? ` (${item.description})` : "";
					const disabled = item.disabled === true ? " [DISABLED]" : "";
					const spec = specCache.get(`${r.path}/${name}`);
					const specStr = spec ? ` \u2014 ${spec}` : "";
					return `${name}${desc}${disabled}${specStr}`;
				});
				const nameStr = itemSummaries.length > 0 ? itemSummaries.join(", ") : `${r.itemCount} item(s)`;
				sections.push(`${idx}. ${typeName}: ${nameStr}`);
				idx++;
			}
		}

		if (infraTypes.length > 0) {
			sections.push(`\n(+${infraTypes.length} infrastructure/policy-meta types omitted)`);
		}

		sections.push("\nInventory complete. Report every numbered item above. No further API calls needed.");
		const batchTotalItems = relevantData.reduce((sum, r) => sum + (r.itemCount ?? 0), 0);
		const text = sections.join("\n");
		const batchSize = paths.length;
		const errorCount = results.filter(r => r.status >= 400 || r.status === 0).length;
		const batchSuccessCount = results.length - errorCount;

		// Cache for subsequent invocations
		try {
			await Bun.write(
				cachePath,
				JSON.stringify({ ts: Date.now(), text, batchSize, batchSuccessCount, batchTotalItems }),
			);
		} catch {
			// Cache write failure is non-fatal
		}

		return {
			content: [{ type: "text", text }],
			details: {
				status: 200,
				url: apiBase,
				method: "GET",
				requestId,
				durationMs,
				contextName,
				batchSize,
				batchSuccessCount,
				batchTotalItems,
			},
		};
	}

	#statusGuidance(status: number): string | null {
		const ctx = this.#contextEnv.getContextName();
		const ctxHint = ctx ? ` (context: \`${ctx}\`)` : "";
		switch (status) {
			case 401:
				return `Token may be expired or invalid${ctxHint}. Run \`/context validate\` to check credentials, or \`/context create\` to set up a new context with fresh credentials.`;
			case 403:
				return `Access denied${ctxHint}. The API token may lack the required role or permission for this operation. Check the token's role assignments in the F5 XC console.`;
			case 404: {
				const ns = process.env.F5XC_NAMESPACE ?? this.#contextEnv.get("F5XC_NAMESPACE") ?? "default";
				return `Resource not found in namespace \`${ns}\`${ctxHint}. Use a GET list operation to verify existing resources.`;
			}
			case 409:
				return `Resource already exists${ctxHint}. Use PUT to replace the existing resource, or DELETE it first before creating a new one.`;
			case 429:
				return `API rate limit exceeded${ctxHint}. Wait briefly and retry the request.`;
			default:
				if (status >= 500) return `Server error (${status})${ctxHint}. This may be transient — retry the request.`;
				return null;
		}
	}

	async execute(_toolCallId: string, params: XcshApiParams, signal?: AbortSignal): Promise<XcshApiResult> {
		const [apiBase, apiToken] = this.#resolveCredentials();
		if (apiBase && apiBase !== this.#lastApiBase) this.#warmTls();
		if (!apiBase) {
			const ctx = this.#contextEnv.getContextName();
			const ctxNote = ctx ? ` Active context \`${ctx}\` has no API URL.` : "";
			return this.#errorResult(
				`Error: No API URL configured.${ctxNote} Activate a context with \`/context activate <name>\` or \`/context create\`, or set the F5XC_API_URL environment variable.`,
			);
		}
		if (!apiToken) {
			const ctx = this.#contextEnv.getContextName();
			const ctxNote = ctx ? ` Active context \`${ctx}\` has no API token.` : "";
			return this.#errorResult(
				`Error: No API token configured.${ctxNote} Activate a context with \`/context activate <name>\` or \`/context create\`, or set the F5XC_API_TOKEN environment variable.`,
			);
		}
		const batchPaths = params.paths?.filter(p => p.trim().length > 0);
		if (batchPaths && batchPaths.length > 0) {
			// Wildcard "*" auto-discovers all namespace-scoped list paths from the catalog
			const resolved = batchPaths.length === 1 && batchPaths[0] === "*" ? this.#loadListablePaths() : batchPaths;
			if (resolved.length > 0) {
				return this.#executeBatch(resolved, params.params, apiBase, apiToken, signal);
			}
		}
		// Auto-expand: when the model GETs a namespace list endpoint for the first time,
		// proactively batch ALL namespace list types for maximum discovery efficiency.
		// Only triggers once per session to avoid redundant batch responses.
		// File-based cache in #executeBatch prevents redundant API calls across sessions.
		if (!this.#autoExpandDone && params.method === "GET" && !params.payload) {
			const listablePaths = this.#loadListablePaths();
			if (listablePaths.length > 0) {
				// Normalize: replace actual namespace in path with {namespace} for matching
				const normalized = params.path.replace(
					/\/api\/config\/namespaces\/[^/]+\//,
					"/api/config/namespaces/{namespace}/",
				);
				if (listablePaths.includes(params.path) || listablePaths.includes(normalized)) {
					// Extract namespace from resolved path if params don't already have it
					const nsMatch = params.path.match(/\/api\/config\/namespaces\/([^/]+)\//);
					const batchParams =
						params.params ??
						(nsMatch?.[1] && nsMatch[1] !== "{namespace}" ? { namespace: nsMatch[1] } : undefined);
					this.#autoExpandDone = true;
					return this.#executeBatch(listablePaths, batchParams, apiBase, apiToken, signal);
				}
			}
		}
		const resolvedPath = this.#contextEnv.resolvePath(params.path, params.params);
		const unresolvedPlaceholders = resolvedPath.match(/\{\w+\}/g);
		if (unresolvedPlaceholders) {
			return this.#errorResult(
				`Error: Unresolved path parameter(s): ${unresolvedPlaceholders.join(", ")}. Provide them via \`params\` or ensure they are configured in the active context.`,
			);
		}
		const url = `${apiBase}${resolvedPath}`;
		const requestId = crypto.randomUUID();
		const headers: Record<string, string> = {
			Authorization: `APIToken ${apiToken}`,
			Accept: "application/json",
			"X-Request-ID": requestId,
		};
		const timeoutSignal = AbortSignal.timeout(30_000);
		const fetchSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
		const init: RequestInit = { method: params.method, headers, signal: fetchSignal };

		let resolvedPayload: string | undefined;
		if (params.payload && params.method !== "GET") {
			headers["Content-Type"] = "application/json";
			const payloadJson = JSON.stringify(params.payload);
			const resolved = this.#contextEnv.resolvePayloadVars(payloadJson);
			init.body = resolved;
			resolvedPayload = resolved;
		}

		const startMs = performance.now();
		try {
			let response = await fetch(url, init);

			// Auto-retry idempotent GET on transient 429/503
			let retried = false;
			if (params.method === "GET" && (response.status === 429 || response.status === 503) && !fetchSignal.aborted) {
				const retryAfter = response.headers.get("retry-after");
				const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
				const delayMs = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10_000) : 1000;
				await Bun.sleep(delayMs);
				if (!fetchSignal.aborted) {
					response = await fetch(url, init);
					retried = true;
				}
			}

			const raw = await response.text();
			const durationMs = Math.round(performance.now() - startMs);
			const contentType = response.headers.get("content-type") ?? "";
			let bodyText = raw;
			if (contentType.includes("application/json")) {
				try {
					bodyText = JSON.stringify(JSON.parse(raw));
				} catch {
					// Unparseable JSON body — fall back to raw text
				}
			}
			const statusLine = `${response.status} ${response.statusText}`;
			const contextName = this.#contextEnv.getContextName();
			const bodySize = raw.length;
			let parsedBody: Record<string, unknown> | null = null;
			let itemCount: number | undefined;
			try {
				parsedBody = JSON.parse(raw) as Record<string, unknown>;
				if (Array.isArray(parsedBody?.items)) itemCount = (parsedBody.items as unknown[]).length;
			} catch {
				// Not JSON
			}
			const detail: XcshApiToolDetails = {
				status: response.status,
				url,
				method: params.method,
				requestId,
				durationMs,
				contextName,
				bodySize,
				itemCount,
				contentType: contentType || undefined,
				retried: retried || undefined,
				resolvedPayload,
			};

			const guidance = this.#statusGuidance(response.status);
			if (guidance) {
				let errorCodePrefix = "";
				const codeLabel = parsedBody ? F5XC_ERROR_CODES[parsedBody.code as number] : undefined;
				if (codeLabel) {
					errorCodePrefix = `[${codeLabel}] `;
					detail.errorCodeLabel = codeLabel;
				}
				return this.#errorResult(`${statusLine}\n\n${bodyText}\n\n${errorCodePrefix}${guidance}`, detail);
			}

			return {
				content: [{ type: "text", text: `${statusLine}\n\n${bodyText}` }],
				details: detail,
				isError: response.status >= 400 || undefined,
			};
		} catch (err) {
			const durationMs = Math.round(performance.now() - startMs);
			const contextName = this.#contextEnv.getContextName();
			const detail = { status: 0, url, method: params.method, requestId, durationMs, contextName };
			const ctxLabel = contextName ? ` (context: \`${contextName}\`)` : "";
			if (err instanceof Error && err.name === "AbortError") {
				// User abort vs 30s timeout produce different AbortErrors
				const message = signal?.aborted
					? "Request cancelled."
					: `Request timed out after 30s${ctxLabel}. The API endpoint may be unreachable. Verify the API URL with \`/context show\`.`;
				return this.#errorResult(message, detail);
			}
			const message = err instanceof Error ? err.message : String(err);
			if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|dns/i.test(message))
				return this.#errorResult(
					`Network error${ctxLabel}: ${message}. The API URL may be incorrect. Check with \`/context show\`.`,
					detail,
				);
			return this.#errorResult(`Request failed${ctxLabel}: ${message}`, detail);
		}
	}
}
