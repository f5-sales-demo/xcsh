/**
 * Transport-neutral host-tool core.
 *
 * The host-tool channel lets the agent delegate the execution of registered
 * tools to whatever host is driving the session (a stdio RPC client, the WS
 * chat bridge, etc.). The bridge, adapter, guards, and wire types here carry no
 * transport specifics — a driver supplies only an `output: (frame) => void`
 * sink — so every transport reuses them verbatim.
 */
export { isRpcHostToolResult, isRpcHostToolUpdate } from "./guards";
export { normalizeHostToolDefinitions, RpcHostToolBridge } from "./host-tools";
export type {
	RpcHostToolCallRequest,
	RpcHostToolCancelRequest,
	RpcHostToolDefinition,
	RpcHostToolResult,
	RpcHostToolUpdate,
} from "./types";
