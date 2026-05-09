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
}

type XcshApiResult = AgentToolResult<XcshApiToolDetails> & { isError?: boolean };

export class XcshApiTool implements AgentTool<typeof xcshApiSchema, XcshApiToolDetails> {
	readonly name = "xcsh_api";
	readonly label = "API";
	readonly description: string;
	readonly parameters = xcshApiSchema;

	#contextEnv: ContextEnv;
	/** Tracks the last API base for context-switch detection and TLS re-warm. */
	#lastApiBase = "";

	constructor(session: ToolSession) {
		this.description = prompt.render(xcshApiDescription);
		this.#contextEnv = createContextEnv(session.settings);

		this.#warmTls();
	}

	/** Pre-warm TLS connection to the current context's API endpoint. */
	#warmTls(): void {
		const apiBase = this.#resolveApiBase();
		const apiToken = this.#resolveApiToken();
		if (apiBase && apiToken) {
			this.#lastApiBase = apiBase;
			fetch(`${apiBase}/api/web/namespaces`, {
				method: "HEAD",
				headers: { Authorization: `APIToken ${apiToken}` },
			}).catch(() => {});
		}
	}

	#resolveApiBase(): string {
		return (process.env.F5XC_API_URL ?? this.#contextEnv.get("F5XC_API_URL") ?? "").replace(/\/+$/, "");
	}

	#resolveApiToken(): string {
		return process.env.F5XC_API_TOKEN ?? this.#contextEnv.get("F5XC_API_TOKEN") ?? "";
	}

	#errorResult(text: string, details?: XcshApiToolDetails): XcshApiResult {
		return {
			content: [{ type: "text", text }],
			...(details ? { details } : {}),
			isError: true,
		};
	}

	/** Context-aware guidance appended to HTTP error responses for common CRUD failures. */
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
				return `Resource not found. Verify the resource name exists in namespace \`${ns}\`${ctxHint}. Use a GET list operation to check existing resources.`;
			}
			case 409:
				return `Resource already exists${ctxHint}. Use PUT to replace the existing resource, or DELETE it first before creating a new one.`;
			case 429:
				return `API rate limit exceeded${ctxHint}. Wait briefly and retry the request.`;
			default:
				return null;
		}
	}

	async execute(_toolCallId: string, params: XcshApiParams, signal?: AbortSignal): Promise<XcshApiResult> {
		const apiBase = this.#resolveApiBase();
		// Detect context switch: API base changed since last call → re-warm TLS
		if (apiBase && apiBase !== this.#lastApiBase) {
			this.#warmTls();
		}
		if (!apiBase) {
			const ctx = this.#contextEnv.getContextName();
			const ctxNote = ctx ? ` Active context \`${ctx}\` has no API URL.` : "";
			return this.#errorResult(
				`Error: No API URL configured.${ctxNote} Activate a context with \`/context activate <name>\` or \`/context create\`, or set the F5XC_API_URL environment variable.`,
			);
		}
		const apiToken = this.#resolveApiToken();
		if (!apiToken) {
			const ctx = this.#contextEnv.getContextName();
			const ctxNote = ctx ? ` Active context \`${ctx}\` has no API token.` : "";
			return this.#errorResult(
				`Error: No API token configured.${ctxNote} Activate a context with \`/context activate <name>\` or \`/context create\`, or set the F5XC_API_TOKEN environment variable.`,
			);
		}
		const resolvedPath = this.#contextEnv.resolvePath(params.path, params.params);

		// Guard: detect unresolved {placeholder} params still remaining in the path.
		// Regex matches \w+ (same as ContextEnv.resolvePath) to avoid misaligned detection.
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

		// Combine user abort signal with 30s timeout. User Ctrl+C is respected.
		const timeoutSignal = AbortSignal.timeout(30_000);
		const fetchSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

		const init: RequestInit = {
			method: params.method,
			headers,
			signal: fetchSignal,
		};

		if (params.payload && params.method !== "GET") {
			headers["Content-Type"] = "application/json";
			const payloadJson = JSON.stringify(params.payload);
			init.body = this.#contextEnv.resolvePayloadVars(payloadJson);
		}

		const startMs = performance.now();
		try {
			const response = await fetch(url, init);
			const raw = await response.text();
			const durationMs = Math.round(performance.now() - startMs);
			const contentType = response.headers.get("content-type") ?? "";
			let bodyText = raw;
			if (contentType.includes("application/json")) {
				try {
					bodyText = JSON.stringify(JSON.parse(raw));
				} catch {
					// Server declared JSON but returned unparseable body — fall back to raw text
				}
			}
			const statusLine = `${response.status} ${response.statusText}`;

			const contextName = this.#contextEnv.getContextName();
			const detail = { status: response.status, url, method: params.method, requestId, durationMs, contextName };

			// Context-aware CRUD error guidance for common HTTP status codes
			const guidance = this.#statusGuidance(response.status);
			if (guidance) {
				return this.#errorResult(`${statusLine}\n\n${bodyText}\n\n${guidance}`, detail);
			}

			return {
				content: [{ type: "text", text: `${statusLine}\n\n${bodyText}` }],
				details: detail,
				...(response.status >= 400 ? { isError: true } : {}),
			};
		} catch (err) {
			const durationMs = Math.round(performance.now() - startMs);
			const contextName = this.#contextEnv.getContextName();
			const detail = { status: 0, url, method: params.method, requestId, durationMs, contextName };
			// Classify error: timeout vs DNS/network vs generic
			const ctxLabel = contextName ? ` (context: \`${contextName}\`)` : "";
			if (err instanceof Error && err.name === "AbortError") {
				// User abort vs 30s timeout produce different AbortErrors
				const message = signal?.aborted
					? "Request cancelled."
					: `Request timed out after 30s${ctxLabel}. The API endpoint may be unreachable. Verify the API URL with \`/context show\`.`;
				return this.#errorResult(message, detail);
			}
			const message = err instanceof Error ? err.message : String(err);
			if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|dns/i.test(message)) {
				return this.#errorResult(
					`Network error${ctxLabel}: ${message}. The API URL may be incorrect. Check with \`/context show\`.`,
					detail,
				);
			}
			return this.#errorResult(`Request failed${ctxLabel}: ${message}`, detail);
		}
	}
}
