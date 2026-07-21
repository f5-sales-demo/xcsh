/**
 * The headless view-model + prop contract for the shared xcsh-terminal chat UI.
 *
 * Every component in this package is headless of transport/protocol/state: it
 * receives all host data + callbacks through these types. The hosts (Office
 * add-in, VS Code webview, Chrome side-panel) map their own protocol/state into
 * these shapes and wire the callbacks — nothing here imports a transport, a
 * protocol module, or a host global.
 */
import type { ReactNode } from "react";

/** Who authored a transcript message. */
export type ChatRole = "user" | "assistant" | "tool";

/**
 * A single transcript row. `text` is the body for user/assistant messages and
 * the tool result for tool rows. Error rows set `error` (and optionally
 * `retryText`, the prompt to resend — the Transcript enables Retry on the LAST
 * message when a retry handler + `retryText` are present).
 */
export interface ChatMessage {
	id: string;
	role: ChatRole;
	text: string;
	/** tool rows only: the tool name and whether it succeeded. */
	tool?: string;
	ok?: boolean;
	/** Render this row as an error (system gutter, alert-red body). */
	error?: boolean;
	/** When set on the last message, the Transcript offers a Retry button. */
	retryText?: string;
}

/** A conversation-mode option (the mode LIST is a host-provided prop). */
export interface InteractionMode {
	id: string;
	label: string;
	blurb?: string;
}

/** A selectable model (the model LIST is a host-provided prop). */
export interface ModelOption {
	id: string;
	label: string;
}

/** A generic dropdown-menu entry (HeaderBar history/more menus). */
export interface MenuItem {
	id: string;
	label: string;
	disabled?: boolean;
}

/** A clickable skill / slash-command pill on the empty state. */
export interface SkillPill {
	id: string;
	label: string;
	hint?: string;
}

/**
 * A category in the composer's attach menu. The host owns the id space (it maps
 * the picked id to its own attachment-sourcing) — the shared UI only renders the
 * label/description and reports the selection.
 */
export interface AttachCategory {
	id: string;
	label: string;
	description?: string;
}

/**
 * A slash command shown in the composer's `/` menu. The host owns the command
 * space; the shared UI renders `label`/`description` and reports the picked
 * `command` string (e.g. "/status"), which the host submits as the prompt.
 */
export interface SlashCommand {
	command: string;
	label: string;
	description?: string;
}

/**
 * A selectable host tool for the composer's multi-select tools picker (opened by
 * the `tools` attach category). The host feeds the list; the shared UI reports
 * the chosen tool `name`s so the host can build a tools attachment.
 */
export interface ToolItem {
	name: string;
	label: string;
	description?: string;
}

/** A rich assistant content block (text / tool_use / thinking). */
export type ContentBlock =
	| { type: "text"; text: string }
	| { type: "tool_use"; toolName: string; input?: string; output?: string; running?: boolean }
	| { type: "thinking"; thinking: string; durationMs?: number };

export type ToolUseBlock = Extract<ContentBlock, { type: "tool_use" }>;

/** Readiness-gate status for the ActivationOverlay checklist. */
export type GateStatus = "pending" | "active" | "passed" | "stalled";

/**
 * One readiness gate. The host computes `label` per its own domain and either
 * supplies a settled `ms` (passed/stalled) or `startedAt` (active) — the overlay
 * counts an active gate up from `startedAt` on a render tick.
 */
export interface ActivationGate {
	name: string;
	label: string;
	status: GateStatus;
	ms?: number;
	startedAt?: number;
}

/** The editable draft behind the Gateway config form. */
export interface GatewayConfigDraft {
	baseUrl: string;
	token: string;
	model?: string;
}

/**
 * Result of a host-provided gateway validator. The host wraps its own
 * `normalizeGatewayConfig` (kept in host core) into this discriminated shape so
 * this package never imports the host's config module.
 */
export type GatewayValidateResult<T> = { ok: true; config: T } | { ok: false; error: string };

export type { ReactNode };
