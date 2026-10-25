/** Ported from the pinned Codex realtime protocols. See NOTICE.md and LICENSE. */
import { ProtocolError } from "./session";
import { handoffOptions } from "./voice-handoff";
export const voices = ["juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol", "cove"];
export const defaultVoice = "cove";
/** First-party discovery schema; advertising this catalogue does not enable V2 execution. */
export const voiceCatalogue = {
	v1: voices,
	v2: ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"],
	defaultV1: defaultVoice,
	defaultV2: "marin",
};
/** Codex's iPhone contract currently sends and requires this literal at the RPC boundary. */
export const CODEX_LIVE_VERSION = "v3";
export function requireLiveVersion(value: unknown): void {
	if (value != null && value !== CODEX_LIVE_VERSION)
		throw new ProtocolError(-32602, "Only the Live realtime protocol is supported");
}
/** Pinned mode instructions are optional strings with an 8192 estimated-token cap. */
export function voiceInstructions(params: Record<string, unknown>) {
	for (const name of ["realtimeStartInstructions", "realtimeEndInstructions"])
		if (
			params[name] != null &&
			(typeof params[name] !== "string" || Buffer.byteLength(params[name] as string) > 32768)
		)
			throw new ProtocolError(-32602, "Invalid realtime mode instructions");
	return {
		start: typeof params.realtimeStartInstructions === "string" ? params.realtimeStartInstructions : undefined,
		end: typeof params.realtimeEndInstructions === "string" ? params.realtimeEndInstructions : undefined,
	};
}
export function existingCallConfig(params: Record<string, unknown>) {
	voiceInstructions(params);
	handoffOptions(params);
	const transport = params.transport as { type?: unknown; callId?: unknown } | undefined;
	if (transport?.type !== "existingCall")
		throw new ProtocolError(-32602, "This native voice gate requires a client-created call");
	const callId = transport.callId;
	if (
		typeof callId !== "string" ||
		!callId ||
		callId.length > 1024 ||
		[".", ".."].includes(callId) ||
		/[\x00-\x1f]/.test(callId)
	)
		throw new ProtocolError(-32602, "Invalid realtime call identity");
	requireLiveVersion(params.version);
	if (params.outputModality !== "audio") throw new ProtocolError(-32602, "Live realtime requires audio output");
	if (
		params.includeStartupContext === true ||
		"prompt" in params ||
		params.model != null ||
		params.voice != null ||
		params.delegationAckFiller != null ||
		(params.initialItems != null && (!Array.isArray(params.initialItems) || params.initialItems.length > 0))
	)
		throw new ProtocolError(
			-32602,
			"Existing-call configuration belongs to the client; startup overrides are unsupported",
		);
	if (
		params.realtimeSessionId != null &&
		(typeof params.realtimeSessionId !== "string" ||
			params.realtimeSessionId.length > 256 ||
			/[\r\n]/.test(params.realtimeSessionId))
	)
		throw new ProtocolError(-32602, "Invalid realtime session identity");
	return {
		kind: "existingCall" as const,
		callId,
		url: `wss://api.openai.com/v1/live/${encodeURIComponent(callId)}`,
		realtimeSessionId: typeof params.realtimeSessionId === "string" ? params.realtimeSessionId : null,
		clientManagedHandoffs: params.clientManagedHandoffs === true,
	};
}
export function contextChunks(text: string): string[] {
	const chunks: string[] = [];
	let chunk = "",
		bytes = 0;
	for (const character of text) {
		const size = Buffer.byteLength(character);
		if (bytes + size > 500) {
			chunks.push(chunk);
			chunk = "";
			bytes = 0;
		}
		chunk += character;
		bytes += size;
	}
	if (chunk || !chunks.length) chunks.push(chunk);
	return chunks;
}
export type VoiceEvent =
	| { kind: "transcript"; done: boolean; role: "user" | "assistant"; text: string; id?: string }
	| { kind: "transcriptBoundary"; role: "user" | "assistant" }
	| { kind: "delegation"; id: string; text: string }
	| { kind: "sessionUpdated"; id: string }
	| {
			kind: "audio";
			data: string;
			sampleRate: number;
			numChannels: number;
	  }
	| { kind: "error" };
export type VoiceEventRejection = "invalidEnvelope" | "invalidPayload" | "unknownType";
export type VoiceEventDisposition = "handled" | "observed" | "rejected";
export interface VoiceEventDecode {
	event: VoiceEvent | null;
	eventType: string;
	disposition: VoiceEventDisposition;
	rejection?: VoiceEventRejection;
}
function object(value: unknown): Record<string, any> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
const knownEventTypes = new Set([
	"error",
	"session.created",
	"session.started",
	"session.updated",
	"input_audio_buffer.speech_started",
	"response.created",
	"input_transcript.added",
	"output_transcript.added",
	"turn.done",
	"delegation.created",
	"output_audio.delta",
	"session.input_audio.append",
	"session.output_audio.delta",
	"session.usage.updated",
	"turn.created",
	"turn.delta",
	"delegation.context.appended",
	"session.instructions.appended",
	"session.context.appended",
]);
function diagnosticEventType(value: unknown): string {
	return typeof value === "string" && /^[a-zA-Z0-9._/-]{1,128}$/.test(value) ? value : "invalid";
}
function validOptionalMilliseconds(value: unknown): boolean {
	return value == null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}
function observedLiveEvent(type: string, value: Record<string, any>): boolean {
	if (type === "session.input_audio.append") return typeof value.audio === "string";
	if (type === "session.output_audio.delta")
		return (
			typeof value.delta === "string" &&
			validOptionalMilliseconds(value.start_ms) &&
			validOptionalMilliseconds(value.end_ms)
		);
	if (type === "session.usage.updated")
		return object(value.usage) !== null && (value.usage_limit == null || object(value.usage_limit) !== null);
	if (type === "turn.created") {
		const turn = object(value.turn);
		return (
			typeof turn?.id === "string" &&
			turn.id.length > 0 &&
			typeof turn.role === "string" &&
			validOptionalMilliseconds(turn.start_ms) &&
			validOptionalMilliseconds(turn.end_ms) &&
			(turn.transcript == null || typeof turn.transcript === "string")
		);
	}
	if (type === "turn.delta")
		return (
			typeof value.turn_id === "string" &&
			value.turn_id.length > 0 &&
			typeof value.delta === "string" &&
			validOptionalMilliseconds(value.start_ms) &&
			validOptionalMilliseconds(value.end_ms)
		);
	if (type === "session.context.appended")
		return (
			typeof value.start_ms === "number" &&
			Number.isFinite(value.start_ms) &&
			value.start_ms >= 0 &&
			typeof value.end_ms === "number" &&
			Number.isFinite(value.end_ms) &&
			value.end_ms >= value.start_ms
		);
	if (type === "session.instructions.appended")
		return (
			(value.client_event_id == null ||
				(typeof value.client_event_id === "string" && value.client_event_id.length > 0)) &&
			typeof value.start_ms === "number" &&
			validOptionalMilliseconds(value.start_ms) &&
			typeof value.end_ms === "number" &&
			validOptionalMilliseconds(value.end_ms) &&
			value.end_ms >= value.start_ms
		);
	if (type === "delegation.context.appended")
		return (
			typeof value.delegation_item_id === "string" &&
			value.delegation_item_id.length > 0 &&
			validOptionalMilliseconds(value.start_ms) &&
			validOptionalMilliseconds(value.end_ms)
		);
	return false;
}
export function inspectVoiceEvent(input: unknown, options: { sideband?: boolean } = {}): VoiceEventDecode {
	const p = object(input);
	if (!p || typeof p.type !== "string")
		return { event: null, eventType: "invalid", disposition: "rejected", rejection: "invalidEnvelope" };
	const eventType = diagnosticEventType(p.type);
	let event: VoiceEvent | null = null;
	if (p.type === "error") event = { kind: "error" };
	else if (p.type === "session.created" || p.type === "session.started" || p.type === "session.updated") {
		const session = object(p.session);
		event = typeof session?.id === "string" ? { kind: "sessionUpdated", id: session.id } : null;
	} else if (p.type === "input_audio_buffer.speech_started") event = { kind: "transcriptBoundary", role: "user" };
	else if (p.type === "response.created") event = { kind: "transcriptBoundary", role: "assistant" };
	const item = object(p.item),
		turn = object(p.turn);
	if (["input_transcript.added", "output_transcript.added"].includes(p.type) && typeof item?.text === "string")
		event = {
			kind: "transcript",
			done: false,
			role: p.type === "input_transcript.added" ? "user" : "assistant",
			text: item.text,
		};
	else if (
		p.type === "turn.done" &&
		(turn?.role === "user" || turn?.role === "assistant") &&
		typeof turn.transcript === "string"
	)
		event = {
			kind: "transcript",
			done: true,
			role: turn.role,
			text: turn.transcript,
			...(typeof turn.id === "string" ? { id: turn.id } : {}),
		};
	else if (
		p.type === "delegation.created" &&
		item?.type === "delegation" &&
		item.target === "client" &&
		typeof item.id === "string" &&
		item.id &&
		Array.isArray(item.content)
	) {
		const text = item.content
			.filter((c: any) => c?.type === "input_text" && typeof c.text === "string")
			.map((c: any) => c.text)
			.join("");
		event = { kind: "delegation", id: item.id, text };
	} else if (p.type === "output_audio.delta" && typeof p.audio === "string")
		event = { kind: "audio", data: p.audio, sampleRate: 24000, numChannels: 1 };
	else if (p.type === "session.output_audio.delta" && typeof p.delta === "string" && !options.sideband)
		event = { kind: "audio", data: p.delta, sampleRate: 24000, numChannels: 1 };
	if (event) return { event, eventType, disposition: "handled" };
	if (observedLiveEvent(p.type, p)) return { event: null, eventType, disposition: "observed", rejection: undefined };
	return {
		event: null,
		eventType,
		disposition: "rejected",
		rejection: knownEventTypes.has(p.type) ? "invalidPayload" : "unknownType",
	};
}
export function decodeVoiceEvent(input: unknown): VoiceEvent | null {
	return inspectVoiceEvent(input).event;
}
