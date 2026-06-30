import type { AgentTool, AgentToolResult } from "@f5-sales-demo/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { PageContextSnapshot } from "../browser/chat-protocol";
import type { ToolSession } from ".";
import { ToolError } from "./tool-errors";

const schema = Type.Object({}, { additionalProperties: false });

export class GetPageContextTool implements AgentTool<typeof schema> {
	readonly name = "get_page_context";
	readonly label = "GetPageContext";
	readonly description =
		"Read the current page context snapshot from the Chrome extension (URL, title, accessibility tree, live API response). Use this to refresh page state mid-conversation if the user may have navigated.";
	readonly parameters = schema;
	readonly strict = true;

	#session: ToolSession;

	constructor(session: ToolSession) {
		this.#session = session;
	}

	static createIf(session: ToolSession): GetPageContextTool | null {
		if (!session.bridgeServer) return null;
		return new GetPageContextTool(session);
	}

	async execute(_toolCallId: string, _params: Record<string, never>): Promise<AgentToolResult> {
		const server = this.#session.bridgeServer;
		if (!server?.connected) {
			throw new ToolError("Chrome extension is not connected.");
		}

		const result = await server.request("get_page_context", {});
		if (result.is_error) {
			throw new ToolError(`Failed to get page context: ${JSON.stringify(result.content)}`);
		}

		const ctx = result.content as PageContextSnapshot;
		const parts: string[] = [];
		parts.push(`URL: ${ctx.url}`);
		parts.push(`Title: ${ctx.title}`);
		parts.push(`Path: ${ctx.path}`);
		if (ctx.api) {
			parts.push(`API (${ctx.api.resourceType}, ${ctx.api.status}): ${ctx.api.url}`);
			if (ctx.api.body) {
				parts.push(typeof ctx.api.body === "string" ? ctx.api.body : JSON.stringify(ctx.api.body, null, 2));
			}
		}
		if (ctx.ax) {
			parts.push(`AX: ${typeof ctx.ax === "string" ? ctx.ax : JSON.stringify(ctx.ax)}`);
		}

		return { content: [{ type: "text", text: parts.join("\n") }] };
	}
}
