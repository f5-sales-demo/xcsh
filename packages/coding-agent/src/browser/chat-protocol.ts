/**
 * Wire protocol types for the Chrome extension chat side window.
 * Contract source of truth: capabilities.json v1.2.0.
 */

// ---------------------------------------------------------------------------
// Page context snapshot (auto-attached by extension to every chat_request)
// ---------------------------------------------------------------------------

export interface PageContextApi {
	url: string;
	status: number;
	resourceType: string;
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
	history_hint: string;
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

export interface ChatError {
	type: "chat_error";
	id: string;
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
