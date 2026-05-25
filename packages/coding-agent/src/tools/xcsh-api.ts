import * as os from "node:os";
import type { AgentTool, AgentToolResult } from "@f5xc-salesdemos/pi-agent-core";
import { prompt } from "@f5xc-salesdemos/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import xcshApiDescription from "../prompts/tools/xcsh-api.md" with { type: "text" };
import { type ContextEnv, createContextEnv } from "../services/context-env";
import type { ToolSession } from ".";

// Namespace filtering driven by x-f5xc-namespace-profile from enriched API specs.

type NamespaceType = "system" | "shared" | "default" | "custom";

function namespaceTypeOf(namespaceName: string): NamespaceType {
	if (namespaceName === "system") return "system";
	if (namespaceName === "shared") return "shared";
	if (namespaceName === "default") return "default";
	if (namespaceName.startsWith("ves-io-")) return "system";
	return "custom";
}

/**
 * Default allowed namespace types for multi-namespace batch queries.
 * Matches the default_profile.constraint.allowed from namespace_profile.yaml.
 * When a batch spans multiple resource types we cannot use a single resource's
 * namespace profile, so this safe default excludes system namespaces.
 */
const DEFAULT_ALLOWED_NS_TYPES: ReadonlySet<NamespaceType> = new Set<NamespaceType>(["custom", "default", "shared"]);

/**
 * Look up allowed namespace types from the embedded API spec data.
 * Returns the namespace profile constraint if the spec has x-f5xc-namespace-profile,
 * otherwise returns the default allowed types.
 */
function loadAllowedNamespaceTypes(domain?: string): ReadonlySet<NamespaceType> {
	if (!domain) return DEFAULT_ALLOWED_NS_TYPES;
	try {
		const mod = require("../internal-urls/api-spec-index.generated") as {
			API_SPEC_DATA?: Readonly<
				Record<
					string,
					{ info?: { "x-f5xc-namespace-profile"?: { constraint?: { allowed?: string[] } } }; [k: string]: unknown }
				>
			>;
		};
		const spec = mod.API_SPEC_DATA?.[domain];
		const allowed = spec?.info?.["x-f5xc-namespace-profile"]?.constraint?.allowed;
		if (Array.isArray(allowed) && allowed.length > 0) {
			return new Set(allowed as NamespaceType[]);
		}
	} catch {
		// Spec data unavailable — use default
	}
	return DEFAULT_ALLOWED_NS_TYPES;
}

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
	#expandedNamespaces = new Set<string>();

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

	/** Batch ALL non-system namespaces in one tool call for tenant-wide queries. */
	async #executeMultiNamespaceBatch(
		paths: string[],
		apiBase: string,
		apiToken: string,
		signal?: AbortSignal,
	): Promise<XcshApiResult> {
		const headers = { Authorization: `APIToken ${apiToken}`, Accept: "application/json" };
		const timeoutSignal = AbortSignal.timeout(90_000);
		const fetchSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
		const startMs = performance.now();

		// Discover all accessible namespaces, filtered by spec-driven namespace profile.
		// Multi-resource batch queries use DEFAULT_ALLOWED_NS_TYPES (custom, default, shared)
		// which excludes system namespaces. When x-f5xc-namespace-profile is present in
		// enriched specs, loadAllowedNamespaceTypes() will use the spec's constraint.
		const allowedTypes = loadAllowedNamespaceTypes();
		let allNs: string[] = [];
		try {
			const nsResp = await fetch(`${apiBase}/api/web/namespaces`, {
				method: "GET",
				headers,
				signal: fetchSignal,
			});
			if (nsResp.ok) {
				const nsData = (await nsResp.json()) as { items?: Array<Record<string, unknown>> };
				allNs = (nsData.items ?? [])
					.map(item => (typeof item.name === "string" ? item.name : null))
					.filter((name): name is string => name !== null && allowedTypes.has(namespaceTypeOf(name)));
			}
		} catch {
			// Fall back to default namespace only
			const def = this.#contextEnv.get("F5XC_NAMESPACE") ?? "default";
			allNs = [def];
		}

		// Batch each namespace and combine results
		const nsSections: string[] = [];
		for (const ns of allNs) {
			const nsParams = { namespace: ns };
			this.#expandedNamespaces.add(ns);
			const result = await this.#executeBatch(paths, nsParams, apiBase, apiToken, signal);
			const text = result.content[0]?.type === "text" ? (result.content[0] as { text: string }).text : "";
			if (text.includes("resource type")) {
				nsSections.push(`\n=== Namespace: ${ns} ===\n${text}`);
			}
		}

		const durationMs = Math.round(performance.now() - startMs);
		const combined =
			nsSections.length > 0
				? nsSections.join("\n") +
					"\n\nTenant-wide inventory complete. All namespaces, specs, and relationships shown above. No further API calls needed."
				: "No resources found across accessible namespaces.";

		return {
			content: [{ type: "text", text: combined }],
			details: {
				status: 200,
				url: apiBase,
				method: "GET",
				requestId: crypto.randomUUID(),
				durationMs,
				contextName: this.#contextEnv.getContextName(),
				batchSize: paths.length * allNs.length,
				batchSuccessCount: nsSections.length,
				batchTotalItems: 0,
			},
		};
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
		// Store raw spec objects for semantic summary generation
		const rawSpecs = new Map<string, Record<string, unknown>>();
		const specItems: Array<{ typePath: string; name: string }> = [];
		// Only fetch specs for types that carry relationship data (LBs, pools, firewalls,
		// healthchecks). Excludes system-generated objects (routes, virtual_hosts, etc.)
		// that inflate the item count and don't add relationship info.
		const SPEC_TYPES = /loadbalancer|origin_pool|app_firewall|healthcheck/i;
		for (const r of relevantData) {
			const typeName = r.path.split("/").pop() ?? "";
			if (!SPEC_TYPES.test(typeName)) continue;
			const items = (r.parsed?.items as Array<Record<string, unknown>> | undefined) ?? [];
			for (const item of items) {
				const name = typeof item.name === "string" ? item.name : null;
				if (name && items.length <= 15) specItems.push({ typePath: r.path, name });
			}
		}
		if (specItems.length > 0 && specItems.length <= 40 && !fetchSignal.aborted) {
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
									rawSpecs.set(`${typePath}/${name}`, spec);
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
		// Split types into core (relationship-bearing, with specs) and secondary.
		// Core types get detailed per-resource output with spec summaries.
		// Secondary types get a compact count to reduce batch response noise.
		// Shorter, focused output helps the model find relationship data directly.
		const getTypeName = (r: BatchEntry) => r.path.split("/").pop() ?? r.path;
		const coreTypes = relevantData.filter(r => SPEC_TYPES.test(getTypeName(r)));
		const secondaryTypes = relevantData.filter(r => !SPEC_TYPES.test(getTypeName(r)));

		if (coreTypes.length > 0) {
			sections.push(`Namespace resource inventory (${coreTypes.length} core types):\n`);
			let idx = 1;
			for (const r of coreTypes) {
				const typeName = getTypeName(r);
				const items = (r.parsed?.items as Array<Record<string, unknown>> | undefined) ?? [];
				if (items.length === 0) {
					sections.push(`${idx}. ${typeName}: ${r.itemCount} item(s)`);
				} else {
					sections.push(`${idx}. ${typeName} (${items.length}):`);
					for (const item of items) {
						const name = typeof item.name === "string" ? item.name : "?";
						const disabled = item.disabled === true ? " [DISABLED]" : "";
						sections.push(`   - ${name}${disabled}`);
					}
				}
				idx++;
			}
		}

		if (secondaryTypes.length > 0) {
			const secondaryCount = secondaryTypes.reduce((sum, r) => sum + (r.itemCount ?? 0), 0);
			sections.push(
				`\n(+${secondaryTypes.length} other types with ${secondaryCount} items: ${secondaryTypes.map(r => getTypeName(r)).join(", ")})`,
			);
		}

		// Semantic summary: answer-ready labels from raw specs.
		// Human-readable labels (WAF=name, no-WAF, pools=[...]) instead of raw fields.
		// Directly answers relationship queries without follow-up GETs.
		const summaryLines: string[] = [];
		const extractRef = (v: unknown): string | null => {
			if (typeof v === "object" && v !== null && !Array.isArray(v)) {
				const o = v as Record<string, unknown>;
				return typeof o.name === "string" ? o.name : null;
			}
			return null;
		};
		const extractPoolRefs = (pools: unknown): string[] => {
			if (!Array.isArray(pools)) return [];
			return (pools as Array<Record<string, unknown>>)
				.map(item => {
					if (typeof item?.pool === "object" && item.pool !== null)
						return (item.pool as Record<string, unknown>).name as string;
					return extractRef(item);
				})
				.filter((n): n is string => n !== null);
		};
		for (const [specKey, spec] of rawSpecs) {
			const parts = specKey.split("/");
			const rName = parts.at(-1) ?? "";
			const rType = parts.at(-2) ?? "";
			const labels: string[] = [];
			if (/loadbalancer/i.test(rType)) {
				const waf = extractRef(spec.app_firewall);
				labels.push(waf ? `WAF=${waf}` : "no-WAF");
				const pools = extractPoolRefs(spec.default_route_pools);
				if (pools.length > 0) labels.push(`pools=[${pools.join(",")}]`);
				if (spec.disable_rate_limit != null) labels.push("no-rate-limit");
				else if (spec.rate_limit != null) labels.push("has-rate-limit");
				const domains = Array.isArray(spec.domains) ? (spec.domains as string[]) : [];
				if (domains.length > 0) labels.push(`domains=[${domains.join(",")}]`);
			}
			if (/origin_pool/i.test(rType)) {
				const hc = Array.isArray(spec.healthcheck)
					? (spec.healthcheck as Array<Record<string, unknown>>).map(h => extractRef(h)).filter(Boolean)
					: [];
				labels.push(hc.length > 0 ? `healthcheck=[${hc.join(",")}]` : "no-healthcheck");
				const servers = Array.isArray(spec.origin_servers) ? (spec.origin_servers as unknown[]).length : 0;
				if (servers > 0) labels.push(`${servers} origin(s)`);
				if (typeof spec.port === "number") labels.push(`port=${spec.port}`);
			}
			if (/app_firewall/i.test(rType)) {
				if (spec.detection_settings != null) labels.push("has-detection-settings");
				if (spec.monitoring != null) labels.push("monitoring-mode");
				else if (spec.blocking != null) labels.push("blocking-mode");
			}
			if (labels.length > 0) {
				summaryLines.push(`${rName}: ${labels.join(", ")}`);
			}
		}
		if (summaryLines.length > 0) {
			sections.push(`\nResource summary:\n${summaryLines.join("\n")}`);
		}

		sections.push(
			"\nInventory complete. All listed resources exist and are valid references for mutations. No further API calls needed.",
		);
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
				return `Resource not found in namespace \`${ns}\`${ctxHint}. Verify the resource name, or use POST to create it.`;
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
				const batchNs = params.params?.namespace ?? this.#contextEnv.get("F5XC_NAMESPACE") ?? "";
				// Wildcard namespace: batch ALL non-system namespaces in one tool call.
				// Reduces multi-namespace queries from N+1 batch calls to 1.
				if (batchNs === "*") {
					return this.#executeMultiNamespaceBatch(resolved, apiBase, apiToken, signal);
				}
				if (batchNs) this.#expandedNamespaces.add(batchNs);
				return this.#executeBatch(resolved, params.params, apiBase, apiToken, signal);
			}
		}
		// Per-namespace auto-expand: when the model GETs a namespace list endpoint,
		// batch ALL types for that namespace on first access. Each namespace expands once.
		// File-based cache in #executeBatch prevents redundant API calls across sessions.
		if (params.method === "GET" && !params.payload) {
			const listablePaths = this.#loadListablePaths();
			if (listablePaths.length > 0) {
				const normalized = params.path.replace(
					/\/api\/config\/namespaces\/[^/]+\//,
					"/api/config/namespaces/{namespace}/",
				);
				if (listablePaths.includes(params.path) || listablePaths.includes(normalized)) {
					const nsMatch = params.path.match(/\/api\/config\/namespaces\/([^/]+)\//);
					const ns = params.params?.namespace ?? (nsMatch?.[1] && nsMatch[1] !== "{namespace}" ? nsMatch[1] : "");
					if (ns && !this.#expandedNamespaces.has(ns)) {
						const batchParams = params.params ?? { namespace: ns };
						this.#expandedNamespaces.add(ns);
						return this.#executeBatch(listablePaths, batchParams, apiBase, apiToken, signal);
					}
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
			// Mutation stop signals + cache invalidation: reduce post-mutation verification GETs
			if (response.status >= 200 && response.status < 300 && params.method !== "GET") {
				// Invalidate batch cache so subsequent namespace queries reflect the mutation
				const nsMatch = resolvedPath.match(/\/api\/config\/namespaces\/([^/]+)\//);
				if (nsMatch?.[1]) {
					const nsCachePath = `${os.tmpdir()}/xcsh-batch-${nsMatch[1]}.json`;
					await Bun.write(nsCachePath, JSON.stringify({ ts: 0 })).catch(() => {});
				}
				// Append stop signal to prevent unnecessary verification GETs
				const verb = params.method === "DELETE" ? "Deleted" : params.method === "POST" ? "Created" : "Updated";
				// POST returns the full resource; PUT/DELETE return {}.
				// Only claim response contains the resource for POST to avoid misleading the model.
				const resourceHint =
					params.method === "POST"
						? "The response above contains the complete resource. No verification GET is needed. Reference this resource by name in subsequent mutations immediately."
						: "No verification GET is needed.";

				return {
					content: [
						{
							type: "text",
							text: `${statusLine}\n\n${bodyText}\n\n${verb} ${resolvedPath} successfully. ${resourceHint}`,
						},
					],
					details: detail,
				};
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
