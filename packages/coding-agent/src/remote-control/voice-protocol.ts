/** Ported from Codex rust-v0.153.4 realtime protocols. See NOTICE.md and LICENSE. */
import { ProtocolError } from "./session";
export type VoiceVersion = "v1" | "v3";
export const voices = {
	v1: ["juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol", "cove"],
	v2: ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"],
	defaultV1: "cove",
	defaultV2: "marin",
};
export function existingCallConfig(params: Record<string, unknown>) {
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
	const version = params.version ?? "v1";
	if (version !== "v1" && version !== "v3")
		throw new ProtocolError(-32602, "Existing calls require realtime v1 or v3");
	if (params.outputModality !== "audio") throw new ProtocolError(-32602, "Realtime v1 and v3 require audio output");
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
		params.codexResponsesAsItems === true ||
		params.realtimeStartInstructions != null ||
		params.realtimeEndInstructions != null
	)
		throw new ProtocolError(-32602, "Unsupported realtime instruction or response-item option");
	if (
		params.realtimeSessionId != null &&
		(typeof params.realtimeSessionId !== "string" ||
			params.realtimeSessionId.length > 256 ||
			/[\r\n]/.test(params.realtimeSessionId))
	)
		throw new ProtocolError(-32602, "Invalid realtime session identity");
	return {
		version: version as VoiceVersion,
		callId,
		url:
			version === "v3"
				? `wss://api.openai.com/v1/live/${encodeURIComponent(callId)}`
				: `wss://api.openai.com/v1/realtime?intent=quicksilver&call_id=${encodeURIComponent(callId)}`,
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
	| { kind: "delegation"; id: string; itemId?: string; text: string }
	| { kind: "audio"; data: string; sampleRate: number; numChannels: number }
	| { kind: "error" };
function object(value: unknown): Record<string, any> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
export function decodeVoiceEvent(version: VoiceVersion, input: unknown): VoiceEvent | null {
	const p = object(input);
	if (!p || typeof p.type !== "string") return null;
	if (p.type === "error") return { kind: "error" };
	if (version === "v3") {
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
	} else {
		const transcriptTypes: Record<string, ["user" | "assistant", boolean]> = {
			"conversation.input_transcript.delta": ["user", false],
			"conversation.item.input_audio_transcription.delta": ["user", false],
			"conversation.input_transcript.turn_marked": ["user", true],
			"conversation.item.input_audio_transcription.completed": ["user", true],
			"conversation.output_transcript.delta": ["assistant", false],
			"response.output_text.delta": ["assistant", false],
			"response.output_audio_transcript.delta": ["assistant", false],
			"response.output_audio_transcript.done": ["assistant", true],
		};
		const shape = transcriptTypes[p.type];
		if (shape) {
			const [role, done] = shape,
				text = p[done ? "transcript" : "delta"];
			if (typeof text === "string")
				return {
					kind: "transcript",
					role,
					done,
					text,
					...(typeof p.item_id === "string" ? { id: p.item_id } : {}),
				};
		}
		if (
			p.type === "conversation.handoff.requested" &&
			typeof p.handoff_id === "string" &&
			p.handoff_id &&
			typeof p.item_id === "string" &&
			typeof p.input_transcript === "string"
		)
			return { kind: "delegation", id: p.handoff_id, itemId: p.item_id, text: p.input_transcript };
		if (
			p.type === "conversation.output_audio.delta" &&
			typeof (p.delta ?? p.data) === "string" &&
			Number.isInteger(p.sample_rate) &&
			Number.isInteger(p.channels ?? p.num_channels)
		)
			return {
				kind: "audio",
				data: p.delta ?? p.data,
				sampleRate: p.sample_rate,
				numChannels: p.channels ?? p.num_channels,
			};
	}
	return null;
}
