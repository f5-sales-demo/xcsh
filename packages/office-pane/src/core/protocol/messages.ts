/**
 * Chat protocol wire types + client-side type guards.
 *
 * REWIRED TO THE NATIVE CONTRACT: the wire message shapes are imported (type
 * only, erased at build) from xcsh's own `@f5-sales-demo/xcsh/browser/chat-protocol`
 * and re-exported here under office-pane's `*Msg` names — there is no vendored
 * re-declaration of the contract to drift. `AgentToolResult` (the host-tool
 * result payload) is imported (type only) from `@f5-sales-demo/pi-agent-core/types`
 * — the narrow subpath, so the type graph never reaches pi-agent-core's runtime.
 *
 * What stays LOCAL (genuinely client-only, browser-safe):
 *  - `ChatToolNoticeMsg`: a host-emitted UI signal (the extension/add-in surfaces
 *    tool activity to the panel). xcsh NEVER emits it, so native chat-protocol.ts
 *    does not declare it — it is a client concept.
 *  - the client-DIRECTION guards below. Native ships only the server-direction
 *    guards (`isChatRequest`/`isConfigure`/…); the panel needs the mirror-image
 *    (`isChatDelta`/`isChatDone`/…), which have no native counterpart.
 */
// Narrow subpath (not the barrel) so the browser bundle's type graph never
// reaches pi-agent-core's runtime (agent → pi-utils), which is not lib.dom-safe.
import type { AgentToolResult } from "@f5-sales-demo/pi-agent-core/types";
import type {
	ChatDelta,
	ChatDone,
	ChatError,
	ChatImage,
	ChatKeepalive,
	ChatReference,
	ChatRequest,
	ChatStop,
	Configure,
	ConfigureAck,
	ConfigureError,
	HostToolCall,
	HostToolCancel,
	HostToolDefinition,
	HostToolResult,
	HostToolUpdate,
	ListCommands,
	ListSkills,
	PathPicked,
	PickPath,
	SetHostTools,
	SkillInfo,
	SkillsList,
	SlashCommandInfo,
	SlashCommandsList,
} from "@f5-sales-demo/xcsh/browser/chat-protocol";
import { CHAT_ERROR_REASONS } from "./reasons";

// --- Native wire types, re-exported under office-pane's local names. ---
export type {
	AgentToolResult,
	ChatDelta as ChatDeltaMsg,
	ChatDone as ChatDoneMsg,
	ChatError as ChatErrorMsg,
	ChatImage as ChatImageMsg,
	ChatKeepalive as ChatKeepaliveMsg,
	ChatReference as ChatRefWire,
	ChatRequest as ChatRequestMsg,
	ChatStop as ChatStopMsg,
	Configure as ConfigureMsg,
	ConfigureAck as ConfigureAckMsg,
	ConfigureError as ConfigureErrorMsg,
	// Native-name aliases retained for parity with the source of truth.
	HostToolCall,
	HostToolCall as HostToolCallMsg,
	HostToolCancel,
	HostToolCancel as HostToolCancelMsg,
	HostToolDefinition,
	HostToolResult,
	HostToolResult as HostToolResultMsg,
	HostToolUpdate,
	HostToolUpdate as HostToolUpdateMsg,
	ListCommands as ListCommandsMsg,
	ListSkills as ListSkillsMsg,
	PathPicked as PathPickedMsg,
	PickPath as PickPathMsg,
	SetHostTools,
	SetHostTools as SetHostToolsMsg,
	SkillInfo,
	SkillsList as SkillsListMsg,
	SlashCommandInfo,
	SlashCommandsList as SlashCommandsListMsg,
};

// ---------------------------------------------------------------------------
// Client-only message (not part of native chat-protocol.ts)
// ---------------------------------------------------------------------------

/** A best-effort UI signal the host surfaces to the panel when a tool runs
 * during a turn. Client-only: xcsh never emits it. */
export interface ChatToolNoticeMsg {
	type: "chat_tool_notice";
	id: string;
	tool: string;
	ok: boolean;
	detail?: string;
}

// ---------------------------------------------------------------------------
// Unions
// ---------------------------------------------------------------------------

export type ChatStreamMsg = ChatDelta | ChatDone | ChatError;

/**
 * Messages the worker sends to the panel (inbound to the panel). Includes the
 * host-tool frames the client RECEIVES (`host_tool_call` / `host_tool_cancel`)
 * and the provider-configure replies.
 */
export type ChatInboundMsg =
	| ChatStreamMsg
	| ChatKeepalive
	| ChatToolNoticeMsg
	| HostToolCall
	| HostToolCancel
	| ConfigureAck
	| ConfigureError
	| SkillsList
	| SlashCommandsList
	| PathPicked;

// ---------------------------------------------------------------------------
// Type guards (client direction — no native equivalent)
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object";
}

export function isChatDelta(msg: unknown): msg is ChatDelta {
	return isObj(msg) && msg.type === "chat_delta";
}

export function isChatDone(msg: unknown): msg is ChatDone {
	return isObj(msg) && msg.type === "chat_done";
}

export function isChatError(msg: unknown): msg is ChatError {
	return (
		isObj(msg) &&
		msg.type === "chat_error" &&
		CHAT_ERROR_REASONS.includes(msg.reason as (typeof CHAT_ERROR_REASONS)[number])
	);
}

export function isChatKeepalive(msg: unknown): msg is ChatKeepalive {
	return isObj(msg) && msg.type === "chat_keepalive";
}

export function isChatToolNotice(msg: unknown): msg is ChatToolNoticeMsg {
	return isObj(msg) && msg.type === "chat_tool_notice";
}

/** Inbound dispatch guard: the agent is asking the client to run a host tool. */
export function isHostToolCall(msg: unknown): msg is HostToolCall {
	return isObj(msg) && msg.type === "host_tool_call" && typeof msg.id === "string" && typeof msg.toolName === "string";
}

/** Inbound dispatch guard: the agent is aborting a pending host-tool call. */
export function isHostToolCancel(msg: unknown): msg is HostToolCancel {
	return (
		isObj(msg) && msg.type === "host_tool_cancel" && typeof msg.id === "string" && typeof msg.targetId === "string"
	);
}

/** Inbound guard: xcsh acknowledged a provider configure. */
export function isConfigureAck(msg: unknown): msg is ConfigureAck {
	return isObj(msg) && msg.type === "configure_ack" && typeof msg.model === "string";
}

/** Inbound guard: xcsh rejected a provider configure. */
export function isConfigureError(msg: unknown): msg is ConfigureError {
	return isObj(msg) && msg.type === "configure_error" && msg.reason === "configuration-rejected";
}

/** Inbound guard: xcsh replied to `list_skills` with the loaded skills. */
export function isSkillsList(msg: unknown): msg is SkillsList {
	return isObj(msg) && msg.type === "skills" && Array.isArray(msg.skills);
}

/** Inbound guard: xcsh replied to `list_commands` with the loaded slash commands. */
export function isSlashCommandsList(msg: unknown): msg is SlashCommandsList {
	return isObj(msg) && msg.type === "commands" && Array.isArray(msg.commands);
}

/** Inbound guard: xcsh replied to `pick_path` with the picker result. */
export function isPathPicked(msg: unknown): msg is PathPicked {
	return isObj(msg) && msg.type === "path_picked";
}
