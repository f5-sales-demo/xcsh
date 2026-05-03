import type { AgentTool, AgentToolResult } from "@f5xc-salesdemos/pi-agent-core";
import { prompt } from "@f5xc-salesdemos/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import xcshApiDescription from "../prompts/tools/xcsh-api.md" with { type: "text" };
import type { ToolSession } from ".";

const xcshApiSchema = Type.Object({
	method: Type.Union([Type.Literal("GET"), Type.Literal("POST"), Type.Literal("PUT"), Type.Literal("DELETE")], {
		description: "HTTP method",
	}),
	path: Type.String({ description: "API path, e.g. /api/config/namespaces/{namespace}/http_loadbalancers" }),
	namespace: Type.Optional(Type.String({ description: "Substituted into {namespace} in path" })),
	name: Type.Optional(Type.String({ description: "Substituted into {name} in path" })),
	payload: Type.Optional(Type.Unknown({ description: "JSON body for POST/PUT requests" })),
});

type XcshApiParams = Static<typeof xcshApiSchema>;

export interface XcshApiToolDetails {
	status: number;
	url: string;
	method: string;
}

type XcshApiResult = AgentToolResult<XcshApiToolDetails> & { isError?: boolean };

export class XcshApiTool implements AgentTool<typeof xcshApiSchema, XcshApiToolDetails> {
	readonly name = "xcsh_api";
	readonly label = "API";
	readonly description: string;
	readonly parameters = xcshApiSchema;

	constructor(_session: ToolSession) {
		this.description = prompt.render(xcshApiDescription);
	}

	async execute(_toolCallId: string, params: XcshApiParams): Promise<XcshApiResult> {
		const apiUrl = process.env.F5XC_API_URL;
		if (!apiUrl) {
			return {
				content: [{ type: "text", text: "Error: F5XC_API_URL environment variable is not set." }],
				isError: true,
			};
		}

		const apiToken = process.env.F5XC_API_TOKEN;
		if (!apiToken) {
			return {
				content: [{ type: "text", text: "Error: F5XC_API_TOKEN environment variable is not set." }],
				isError: true,
			};
		}

		let resolvedPath = params.path;
		if (params.namespace) {
			resolvedPath = resolvedPath.replaceAll("{namespace}", params.namespace);
		}
		if (params.name) {
			resolvedPath = resolvedPath.replaceAll("{name}", params.name);
		}

		const url = `${apiUrl.replace(/\/+$/, "")}${resolvedPath}`;
		const headers: Record<string, string> = {
			Authorization: `APIToken ${apiToken}`,
			Accept: "application/json",
		};

		const init: RequestInit = { method: params.method, headers };

		if (params.payload && (params.method === "POST" || params.method === "PUT")) {
			headers["Content-Type"] = "application/json";
			init.body = JSON.stringify(params.payload);
		}

		try {
			const response = await fetch(url, init);
			const contentType = response.headers.get("content-type") ?? "";
			let bodyText: string;

			if (contentType.includes("application/json")) {
				const json = await response.json();
				bodyText = JSON.stringify(json, null, 2);
			} else {
				bodyText = await response.text();
			}

			const statusLine = `${response.status} ${response.statusText}`;

			return {
				content: [{ type: "text", text: `${statusLine}\n\n${bodyText}` }],
				details: { status: response.status, url, method: params.method },
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
