import type { AgentTool, AgentToolResult } from "@f5xc-salesdemos/pi-agent-core";
import { prompt } from "@f5xc-salesdemos/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import xcshApiDescription from "../prompts/tools/xcsh-api.md" with { type: "text" };
import { createContextEnv } from "../services/context-env";
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
}

type XcshApiResult = AgentToolResult<XcshApiToolDetails> & { isError?: boolean };

export class XcshApiTool implements AgentTool<typeof xcshApiSchema, XcshApiToolDetails> {
	readonly name = "xcsh_api";
	readonly label = "API";
	readonly description: string;
	readonly parameters = xcshApiSchema;

	#apiBase: string;
	#apiToken: string;
	#contextEnv: ReturnType<typeof createContextEnv>;

	constructor(session: ToolSession) {
		this.description = prompt.render(xcshApiDescription);
		this.#apiBase = (process.env.F5XC_API_URL ?? "").replace(/\/+$/, "");
		this.#apiToken = process.env.F5XC_API_TOKEN ?? "";
		this.#contextEnv = createContextEnv(session.settings);

		if (this.#apiBase && this.#apiToken) {
			fetch(`${this.#apiBase}/api/web/namespaces`, {
				method: "HEAD",
				headers: { Authorization: `APIToken ${this.#apiToken}` },
			}).catch(() => {});
		}
	}

	async execute(_toolCallId: string, params: XcshApiParams): Promise<XcshApiResult> {
		if (!this.#apiBase) {
			return {
				content: [{ type: "text", text: "Error: F5XC_API_URL environment variable is not set." }],
				isError: true,
			};
		}

		if (!this.#apiToken) {
			return {
				content: [{ type: "text", text: "Error: F5XC_API_TOKEN environment variable is not set." }],
				isError: true,
			};
		}

		const resolvedPath = this.#contextEnv.resolvePath(params.path, params.params);

		const url = `${this.#apiBase}${resolvedPath}`;
		const requestId = crypto.randomUUID();
		const headers: Record<string, string> = {
			Authorization: `APIToken ${this.#apiToken}`,
			Accept: "application/json",
			"X-Request-ID": requestId,
		};

		const init: RequestInit = {
			method: params.method,
			headers,
			signal: AbortSignal.timeout(30_000),
		};

		if (params.payload && params.method !== "GET") {
			headers["Content-Type"] = "application/json";
			const payloadJson = JSON.stringify(params.payload);
			init.body = this.#contextEnv.resolvePayloadVars(payloadJson);
		}

		try {
			const response = await fetch(url, init);
			const raw = await response.text();
			const contentType = response.headers.get("content-type") ?? "";
			const bodyText = contentType.includes("application/json") ? JSON.stringify(JSON.parse(raw)) : raw;
			const statusLine = `${response.status} ${response.statusText}`;

			return {
				content: [{ type: "text", text: `${statusLine}\n\n${bodyText}` }],
				details: { status: response.status, url, method: params.method, requestId },
				...(response.status >= 400 ? { isError: true } : {}),
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Request failed: ${message}` }],
				isError: true,
			};
		}
	}
}
