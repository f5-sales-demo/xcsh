/**
 * Host-tool wire types (transport-neutral).
 *
 * These frames describe the bidirectional host-tool channel: the agent asks the
 * host to execute a registered tool, and the host streams updates / a result
 * back. They are shared verbatim across transports (stdio RPC and the WS chat
 * bridge), so they live outside of any single transport driver.
 */
// Narrow subpath (not the barrel) so browser-safe consumers of these wire types
// don't transitively pull pi-agent-core's runtime graph (agent → pi-utils), which
// is not lib.dom-safe. AgentToolResult is a pure type.
import type { AgentToolResult } from "@f5-sales-demo/pi-agent-core/types";

export interface RpcHostToolDefinition {
	name: string;
	label?: string;
	description: string;
	parameters: Record<string, unknown>;
	hidden?: boolean;
}

/** Emitted by the agent when it needs the host to execute a registered tool. */
export interface RpcHostToolCallRequest {
	type: "host_tool_call";
	id: string;
	toolCallId: string;
	toolName: string;
	arguments: Record<string, unknown>;
}

/** Emitted by the agent when a pending host tool call should be aborted. */
export interface RpcHostToolCancelRequest {
	type: "host_tool_cancel";
	id: string;
	targetId: string;
}

/** Sent by the host to stream partial tool updates back to the agent. */
export interface RpcHostToolUpdate {
	type: "host_tool_update";
	id: string;
	partialResult: AgentToolResult<unknown>;
}

/** Sent by the host to complete a pending tool call. */
export interface RpcHostToolResult {
	type: "host_tool_result";
	id: string;
	result: AgentToolResult<unknown>;
	isError?: boolean;
}
