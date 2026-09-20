/** Ported from Codex rust-v0.153.4 realtime protocols. See NOTICE.md and LICENSE. */
import { ProtocolError } from "./session";
import { handoffOptions } from "./voice-handoff";
export const voices = ["juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol", "cove"];
export const defaultVoice = "cove";
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
		params.includeStartupContext !== false ||
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
	| { kind: "delegation"; id: string; text: string }
	| { kind: "sessionUpdated"; id: string }
	| {
			kind: "audio";
			data: string;
			sampleRate: number;
			numChannels: number;
	  }
	| { kind: "error" };
function object(value: unknown): Record<string, any> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
export function decodeVoiceEvent(input: unknown): VoiceEvent | null {
	const p = object(input);
	if (!p || typeof p.type !== "string") return null;
	if (p.type === "error") return { kind: "error" };
	if (p.type === "session.updated") {
		const session = object(p.session);
		return typeof session?.id === "string" ? { kind: "sessionUpdated", id: session.id } : null;
	}
	const item = object(p.item),
		turn = object(p.turn);
	if (["input_transcript.added", "output_transcript.added"].includes(p.type) && typeof item?.text === "string")
		return {
			kind: "transcript",
			done: false,
			role: p.type === "input_transcript.added" ? "user" : "assistant",
			text: item.text,
		};
	if (
		p.type === "turn.done" &&
		(turn?.role === "user" || turn?.role === "assistant") &&
		typeof turn.transcript === "string"
	)
		return {
			kind: "transcript",
			done: true,
			role: turn.role,
			text: turn.transcript,
			...(typeof turn.id === "string" ? { id: turn.id } : {}),
		};
	if (
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
		return text.trim() ? { kind: "delegation", id: item.id, text } : null;
	}
	if (p.type === "output_audio.delta" && typeof p.audio === "string")
		return { kind: "audio", data: p.audio, sampleRate: 24000, numChannels: 1 };
	return null;
}
