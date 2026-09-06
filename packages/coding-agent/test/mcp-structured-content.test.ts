import { beforeAll, describe, expect, test } from "bun:test";
import type { CustomToolContext, CustomToolResult } from "../src/extensibility/custom-tools/types";
import { renderMCPResult } from "../src/mcp/render";
import { MCPTool, type MCPToolDetails } from "../src/mcp/tool-bridge";
import type { MCPServerConnection, MCPToolCallResult, MCPToolDefinition } from "../src/mcp/types";
import { getThemeByName, initTheme } from "../src/modes/theme/theme";

function toolFor(result: MCPToolCallResult): MCPTool {
	const connection = {
		name: "rhizome-mcp",
		transport: {
			connected: true,
			request: async (method: string) => {
				if (method === "tools/call") return result as unknown;
				throw new Error(`unexpected method ${method}`);
			},
			notify: async () => {},
			close: async () => {},
		},
	} as unknown as MCPServerConnection;
	const definition: MCPToolDefinition = { name: "list_issues", inputSchema: { type: "object" } };
	return new MCPTool(connection, definition);
}

function build(result: MCPToolCallResult): Promise<CustomToolResult<MCPToolDetails>> {
	return toolFor(result).execute("call-1", {}, undefined, {} as CustomToolContext);
}

async function modelText(result: MCPToolCallResult): Promise<string> {
	const built = await build(result);
	return built.content.map(block => (block.type === "text" ? block.text : `[${block.type}]`)).join("\n");
}

describe("MCP bridge structuredContent", () => {
	test("surfaces structuredContent when content is a minimal acknowledgement", async () => {
		const text = await modelText({
			content: [{ type: "text", text: "issues listed" }],
			structuredContent: {
				items: [],
				next_cursor: null,
				next_actions: ["Inspect a claimable issue with get_work_context."],
			},
		});

		expect(text).toContain("issues listed");
		expect(text).toContain("next_actions");
		expect(text).toContain("Inspect a claimable issue with get_work_context.");
	});

	test("does not duplicate structuredContent already echoed verbatim", async () => {
		const payload = { lease_token: "abc123", expires_in: 900 };
		const text = await modelText({
			content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
			structuredContent: payload,
		});

		expect(text.split("abc123")).toHaveLength(2);
	});

	test("leaves legacy content-only results unchanged", async () => {
		expect(await modelText({ content: [{ type: "text", text: "plain result" }] })).toBe("plain result");
	});
});

describe("MCP result multi-block rendering", () => {
	beforeAll(async () => {
		await initTheme();
	}, 15_000);

	test("renders every text block", async () => {
		const theme = await getThemeByName("xcsh-dark");
		if (!theme) throw new Error("dark theme missing");
		const result: CustomToolResult<MCPToolDetails> = {
			content: [
				{ type: "text", text: "first block" },
				{ type: "text", text: "second block" },
			],
			details: { serverName: "test", mcpToolName: "list_issues" },
		};
		const rendered = Bun.stripANSI(
			renderMCPResult(result, { expanded: true, isPartial: false }, theme).render(160).join("\n"),
		);

		expect(rendered).toContain("first block");
		expect(rendered).toContain("second block");
	});
});
