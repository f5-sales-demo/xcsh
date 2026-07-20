/**
 * Wire protocol types for the Chrome extension chat side window.
 * Contract source of truth: capabilities.json v1.2.0.
 */

import {
	isRpcHostToolResult,
	isRpcHostToolUpdate,
	type RpcHostToolCallRequest,
	type RpcHostToolCancelRequest,
	type RpcHostToolDefinition,
	type RpcHostToolResult,
	type RpcHostToolUpdate,
} from "../host-tools";

// ---------------------------------------------------------------------------
// Page context snapshot (auto-attached by extension to every chat_request)
// ---------------------------------------------------------------------------

export interface PageContextApi {
	url: string;
	status: number;
	resourceType: string | null;
	body: unknown;
	truncated: boolean;
}

export interface PageContextSnapshot {
	v: 1;
	capturedAt: number;
	tabId: number;
	url: string;
	path: string;
	title: string;
	ax: unknown | null;
	api: PageContextApi | null;
	truncated: boolean;
}

// ---------------------------------------------------------------------------
// Interaction modes
// ---------------------------------------------------------------------------

export type InteractionMode = "educational" | "presentation" | "configuration" | "screenshot" | "annotation";

const VALID_MODES = new Set<string>(["educational", "presentation", "configuration", "screenshot", "annotation"]);

// ---------------------------------------------------------------------------
// References (attached to chat_done)
// ---------------------------------------------------------------------------

export interface ChatReference {
	kind: "doc" | "console";
	title: string;
	url: string;
}

// ---------------------------------------------------------------------------
// Inbound messages (extension → xcsh)
// ---------------------------------------------------------------------------

export interface ChatRequest {
	type: "chat_request";
	id: string;
	text: string;
	context: PageContextSnapshot | null;
	mode: InteractionMode;
	history_hint?: string;
}

export interface ChatStop {
	type: "chat_stop";
	id: string;
}

// ---------------------------------------------------------------------------
// Outbound messages (xcsh → extension)
// ---------------------------------------------------------------------------

export interface ChatDelta {
	type: "chat_delta";
	id: string;
	seq: number;
	delta: string;
}

export interface ChatDone {
	type: "chat_done";
	id: string;
	references?: ChatReference[];
}

/** Machine-readable cause of a terminal chat_error, so the panel can render a
 * distinct, actionable message (and decide whether to auto-recover) instead of a
 * generic failure. Additive/optional on the wire (contract 1.6.0); an omitted
 * reason means an unclassified error (legacy behavior — show the error text).
 * Shared vocabulary with the extension (keep both lists identical). */
export const CHAT_ERROR_REASONS = [
	"bridge-disconnected", // the worker's bridge closed mid-turn
	"bridge-unresponsive", // the socket looked open but the worker never answered
	"no-worker", // no worker is running for this tab
	"session-busy", // a turn is already in flight for this session
	"session-disposed", // the worker session was torn down
	"token-expired", // F5 XC API token expired
	"token-expiring", // F5 XC API token is about to expire
	"provider-4xx", // upstream provider rejected the request (client error)
	"provider-5xx", // upstream provider failed (server error) — retryable
] as const;

export type ChatErrorReason = (typeof CHAT_ERROR_REASONS)[number];

export interface ChatError {
	type: "chat_error";
	id: string;
	error: string;
	reason?: ChatErrorReason;
}

/** Liveness signal (contract 1.7.0): the worker is actively working the turn — e.g.
 * streaming model thinking — before any visible token. The panel treats it as
 * proof-of-life to re-arm its first-token timer, so a long legitimate think isn't
 * mistaken for a dead worker. Carries no renderable content. */
export interface ChatKeepalive {
	type: "chat_keepalive";
	id: string;
}

// ---------------------------------------------------------------------------
// Host-tool channel (contract 1.8.0)
//
// The host-tool channel lets the agent delegate a registered tool's execution
// to whatever host is driving the WS bridge (the chrome extension, an Office
// add-in, etc.). The frames are FIELD-IDENTICAL to the transport-neutral
// `RpcHostTool*` vocabulary (`src/host-tools/`), so they are re-exported here
// rather than re-declared — one vocabulary across every transport, no drift.
//
// CRITICAL: `host_tool_result.result` and `host_tool_update.partialResult` are
// `AgentToolResult` values — a `content[]` array — NOT a `{ data }` object. The
// guards below delegate to the neutral `isRpcHostToolResult`/`isRpcHostToolUpdate`,
// which require `content` to be an array.
// ---------------------------------------------------------------------------

/** A host-tool definition advertised by the client via `set_host_tools`. */
export type HostToolDefinition = RpcHostToolDefinition;

/** Inbound: the client registers the host tools it can execute. */
export interface SetHostTools {
	type: "set_host_tools";
	tools: HostToolDefinition[];
}

/** Outbound: the agent asks the client to execute a registered host tool. */
export type HostToolCall = RpcHostToolCallRequest;

/** Outbound: the agent aborts a pending host-tool call. */
export type HostToolCancel = RpcHostToolCancelRequest;

/** Inbound: the client streams a partial `AgentToolResult` for a pending call. */
export type HostToolUpdate = RpcHostToolUpdate;

/** Inbound: the client completes a pending call with an `AgentToolResult`. */
export type HostToolResult = RpcHostToolResult;

/** Outbound: acks a `set_host_tools` registration so the client can await it
 * before sending its first prompt. Carries the names actually registered. */
export interface SetHostToolsAck {
	type: "set_host_tools_ack";
	toolNames: string[];
}

/** Outbound: nacks a `set_host_tools` registration that failed to normalize (bad
 * definition, name conflict). Emitted instead of the ack so a client awaiting
 * registration gets a clear error rather than hanging (stdio-parity nack). */
export interface SetHostToolsError {
	type: "set_host_tools_error";
	error: string;
}

// ---------------------------------------------------------------------------
// Provider configuration channel (contract 1.9.0)
//
// Lets a bridge client (the Chrome extension, the office-xcsh add-in) configure
// xcsh's LLM provider at runtime — after the socket is connected — without
// restarting the worker and WITHOUT persisting the token to disk. xcsh stays the
// intelligence engine; this only swaps the provider credentials/model in session
// memory. Single config in-flight, so — like `set_host_tools` — there is no `id`
// correlation field. Mirrors the set_host_tools ack/nack shape exactly.
// ---------------------------------------------------------------------------

/** Inbound: the client configures the LLM provider. `token` is required and
 * non-empty. `baseUrl` (optional) is an Anthropic-compatible gateway base; when
 * omitted, the baked F5 gateway is reused and only the runtime API key is set.
 * `model` (optional) selects the model id; when omitted, the session default is
 * kept. The token lives in session/runtime memory only — never written to disk. */
export interface Configure {
	type: "configure";
	baseUrl?: string;
	token: string;
	model?: string;
}

/** Outbound: acks a `configure` with the model id actually selected, so the
 * client can await configuration before its first prompt. */
export interface ConfigureAck {
	type: "configure_ack";
	model: string;
}

/** Outbound: nacks a `configure` that failed (bad frame, unknown model, missing
 * API key). Emitted instead of the ack so a client awaiting it never hangs. */
export interface ConfigureError {
	type: "configure_error";
	error: string;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function hasChatIdPrefix(id: unknown): id is string {
	return typeof id === "string" && id.startsWith("c-");
}

export function isChatRequest(msg: Record<string, unknown>): boolean {
	return (
		msg.type === "chat_request" &&
		hasChatIdPrefix(msg.id) &&
		typeof msg.text === "string" &&
		typeof msg.mode === "string" &&
		VALID_MODES.has(msg.mode)
	);
}

export function isChatStop(msg: Record<string, unknown>): boolean {
	return msg.type === "chat_stop" && hasChatIdPrefix(msg.id);
}

export function isSetHostTools(msg: Record<string, unknown>): boolean {
	return msg.type === "set_host_tools" && Array.isArray(msg.tools);
}

/** True for a well-formed `configure` frame: a non-empty string `token` is required;
 * `baseUrl`/`model`, when present, must be strings. */
export function isConfigure(msg: Record<string, unknown>): boolean {
	return (
		msg.type === "configure" &&
		typeof msg.token === "string" &&
		msg.token.length > 0 &&
		(msg.baseUrl === undefined || typeof msg.baseUrl === "string") &&
		(msg.model === undefined || typeof msg.model === "string")
	);
}

/** Delegates to the neutral guard, which requires `result.content` to be an array. */
export function isHostToolResult(msg: Record<string, unknown>): boolean {
	return isRpcHostToolResult(msg);
}

/** Delegates to the neutral guard, which requires `partialResult.content` to be an array. */
export function isHostToolUpdate(msg: Record<string, unknown>): boolean {
	return isRpcHostToolUpdate(msg);
}
