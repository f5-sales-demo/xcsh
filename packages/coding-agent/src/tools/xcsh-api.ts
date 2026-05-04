import type { AgentTool, AgentToolResult } from "@f5xc-salesdemos/pi-agent-core";
import { prompt } from "@f5xc-salesdemos/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import xcshApiDescription from "../prompts/tools/xcsh-api.md" with { type: "text" };
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
				"Path parameter substitutions, e.g. { namespace: 'default', name: 'example-lb', vh_name: 'example-vh' }",
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

	constructor(_session: ToolSession) {
		this.description = prompt.render(xcshApiDescription);
		this.#apiBase = (process.env.F5XC_API_URL ?? "").replace(/\/+$/, "");
		this.#apiToken = process.env.F5XC_API_TOKEN ?? "";

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

		let resolvedPath = params.path;
		if (params.params) {
			for (const [key, value] of Object.entries(params.params)) {
				resolvedPath = resolvedPath.replaceAll(`{${key}}`, value);
			}
		}

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
			init.body = JSON.stringify(params.payload);
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
