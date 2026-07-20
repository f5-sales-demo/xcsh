/**
 * Transport-neutral host-tool frame guards.
 *
 * Kept in a leaf module — depending ONLY on the wire types (`./types`) and
 * pi-agent-core's `AgentToolResult` *type* — so browser-safe consumers (e.g.
 * `../browser/chat-protocol`) can import the guards WITHOUT loading the
 * `RpcHostToolBridge` in `./host-tools`, which pulls the theme + tool-proxy
 * runtime graph. That graph is fine for the agent runtime but drags node-coupled
 * modules into a browser (lib.dom) TypeScript program.
 */
import type { AgentToolResult } from "@f5-sales-demo/pi-agent-core/types";
import type { RpcHostToolResult, RpcHostToolUpdate } from "./types";

function isAgentToolResult(value: unknown): value is AgentToolResult<unknown> {
	if (!value || typeof value !== "object") return false;
	const content = (value as { content?: unknown }).content;
	return Array.isArray(content);
}

export function isRpcHostToolResult(value: unknown): value is RpcHostToolResult {
	if (!value || typeof value !== "object") return false;
	const frame = value as { type?: unknown; id?: unknown; result?: unknown };
	return frame.type === "host_tool_result" && typeof frame.id === "string" && isAgentToolResult(frame.result);
}

export function isRpcHostToolUpdate(value: unknown): value is RpcHostToolUpdate {
	if (!value || typeof value !== "object") return false;
	const frame = value as { type?: unknown; id?: unknown; partialResult?: unknown };
	return frame.type === "host_tool_update" && typeof frame.id === "string" && isAgentToolResult(frame.partialResult);
}
